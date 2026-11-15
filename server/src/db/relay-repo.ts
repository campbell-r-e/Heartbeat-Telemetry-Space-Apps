import type pg from "pg";
import { RELAY_DIRECTIONS, type RelayDirection, type RelayEventKind, type RelayEventOf, type RelayPayloads } from "@heartbeat/shared";
import type { RelayReader, RelaySender, RelayStore } from "../domain/ports.ts";
import { asRelayEvent, eventAstronautId } from "../domain/relay/events.ts";
import { withTransaction, type Queryable } from "./pool.ts";

interface EventRow {
  id: number; kind: RelayEventKind; direction: RelayDirection; seq: number; payload: unknown; sent_ms: number; deliver_ms: number;
}

const COLUMNS = "id, kind, direction, seq, payload, sent_ms, deliver_ms";
/** Arrival order: each direction's events arrive in send order (deliverAt never goes back), so seq breaks ties. */
const ARRIVAL_ORDER = "deliver_ms, direction, seq";
/** Not handed over yet and not set aside as failed. */
const WAITING = "delivered_ms IS NULL AND failed_ms IS NULL";

/**
 * Rows are written only by `append`, which stores each payload under its own kind, so a row's
 * payload is the payload type of its kind.
 */
function toEvent<K extends RelayEventKind>(row: EventRow): RelayEventOf<K> {
  return {
    id: String(row.id),
    kind: row.kind as K,
    direction: row.direction,
    seq: row.seq,
    payload: row.payload as RelayPayloads[K],
    sentAt: new Date(row.sent_ms).toISOString(),
    deliverAt: new Date(row.deliver_ms).toISOString(),
  };
}

/** The reads, on the pool or on one transaction. */
function relayReader(db: Queryable): RelayReader {
  return {
    async find(kind, id) {
      // Compared as text, so an id that is not a number is simply not found.
      const { rows } = await db.query<EventRow>(`SELECT ${COLUMNS} FROM relay_events WHERE kind = $1 AND id::text = $2`, [kind, id]);
      return rows[0] ? toEvent(rows[0]) : null;
    },

    async list(kind, filter = {}) {
      const { rows } = await db.query<EventRow>(
        `SELECT ${COLUMNS} FROM relay_events
         WHERE kind = $1 AND ($2::text IS NULL OR astronaut_id = $2) AND ($3::bigint IS NULL OR deliver_ms <= $3)
           AND ($4::bigint IS NULL OR sent_ms >= $4) AND ($5::bigint IS NULL OR sent_ms <= $5)
         ORDER BY ${ARRIVAL_ORDER}`,
        [kind, filter.astronautId ?? null, filter.deliveredByMs ?? null, filter.sentFromMs ?? null, filter.sentToMs ?? null],
      );
      return rows.map((row) => toEvent(row));
    },

    async latestDelivered(kind, nowMs) {
      const { rows } = await db.query<EventRow>(
        `SELECT ${COLUMNS} FROM relay_events WHERE kind = $1 AND deliver_ms <= $2 ORDER BY deliver_ms DESC, seq DESC LIMIT 1`,
        [kind, nowMs],
      );
      return rows[0] ? toEvent(rows[0]) : null;
    },

    async latestDeliveredPerAstronaut(kind, nowMs) {
      const { rows } = await db.query<EventRow>(
        `SELECT DISTINCT ON (astronaut_id) ${COLUMNS} FROM relay_events
         WHERE kind = $1 AND deliver_ms <= $2 ORDER BY astronaut_id, deliver_ms DESC, seq DESC`,
        [kind, nowMs],
      );
      return rows.map((row) => toEvent(row));
    },
  };
}

/** The reads plus append, inside a transaction that holds one direction's send lock. */
function relaySender(tx: Queryable, direction: RelayDirection): RelaySender {
  return {
    ...relayReader(tx),

    async append(kind, payload, sentAtMs, deliverAt) {
      if (RELAY_DIRECTIONS[kind] !== direction) throw new Error(`a ${kind} event travels ${RELAY_DIRECTIONS[kind]}, not ${direction}`);
      const { rows: [last] } = await tx.query<{ deliver_ms: number | null; seq: number | null }>(
        "SELECT max(deliver_ms) AS deliver_ms, max(seq) AS seq FROM relay_events WHERE direction = $1", [direction],
      );
      // astronaut_id has its own column so per-astronaut reads are indexed.
      const { rows: [row] } = await tx.query<EventRow>(
        `INSERT INTO relay_events (kind, direction, seq, astronaut_id, payload, sent_ms, deliver_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [kind, direction, (last.seq ?? 0) + 1, eventAstronautId(kind, payload), JSON.stringify(payload), sentAtMs, deliverAt(last.deliver_ms)],
      );
      return toEvent(row);
    },
  };
}

export function relayRepo(pool: pg.Pool): RelayStore {
  return {
    ...relayReader(pool),

    inDirection(direction, work) {
      return withTransaction(pool, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`relay:${direction}`]);
        return work(relaySender(tx, direction));
      });
    },

    async dueUndelivered(nowMs) {
      const { rows } = await pool.query<EventRow & { attempts: number; retry_at_ms: number | null }>(
        `SELECT ${COLUMNS}, attempts, retry_at_ms FROM relay_events WHERE ${WAITING} AND deliver_ms <= $1 ORDER BY ${ARRIVAL_ORDER}`,
        [nowMs],
      );
      return rows.map((row) => ({ event: asRelayEvent(toEvent(row)), failedAttempts: row.attempts, retryAtMs: row.retry_at_ms }));
    },

    async latestHandedOver(kind) {
      const { rows } = await pool.query<EventRow>(
        `SELECT ${COLUMNS} FROM relay_events WHERE kind = $1 AND delivered_ms IS NOT NULL ORDER BY seq DESC LIMIT 1`, [kind],
      );
      return rows[0] ? toEvent(rows[0]) : null;
    },

    async recordFailedAttempt(id, retryAtMs) {
      await pool.query("UPDATE relay_events SET attempts = attempts + 1, retry_at_ms = $2 WHERE id::text = $1", [id, retryAtMs]);
    },

    async markFailed(id, atMs) {
      await pool.query("UPDATE relay_events SET failed_ms = $2 WHERE id::text = $1", [id, atMs]);
    },

    async pruneHandedOver(kind, beforeMs) {
      const { rowCount } = await pool.query(
        `DELETE FROM relay_events WHERE kind = $1 AND delivered_ms IS NOT NULL AND deliver_ms < $2
           AND id NOT IN (SELECT DISTINCT ON (astronaut_id) id FROM relay_events
                          WHERE kind = $1 AND delivered_ms IS NOT NULL ORDER BY astronaut_id, deliver_ms DESC, seq DESC)`,
        [kind, beforeMs],
      );
      return rowCount ?? 0;
    },

    async markDelivered(id, atMs) {
      await pool.query("UPDATE relay_events SET delivered_ms = $2 WHERE id::text = $1", [id, atMs]);
    },

    async nextDeliverAtMs(afterMs) {
      const { rows: [{ next }] } = await pool.query<{ next: number | null }>(
        `SELECT min(deliver_ms) AS next FROM relay_events WHERE ${WAITING} AND deliver_ms > $1`, [afterMs],
      );
      return next;
    },
  };
}
