import type pg from "pg";
import type { AlertLogEntry, Status, StatusMessage } from "@heartbeat/shared";
import type { StatusLogStore } from "../domain/ports.ts";
import type { StatusChangeSubject, StoredSubject } from "../domain/status/status-log.ts";
import { withTransaction, type Queryable } from "./pool.ts";

interface StateRow { subject_key: string; subject: StatusChangeSubject; status: Status | null; title: string }
interface LogRow {
  id: number; astronaut_id: string; at_ms: number; subject: StatusChangeSubject;
  from_status: Status | null; to_status: Status | null; title: string; message: StatusMessage | null;
}

export function statusLogRepo(pool: pg.Pool): StatusLogStore {
  return {
    update(astronautId, compute) {
      return withTransaction(pool, async (tx) => {
        // One evaluation at a time per astronaut, so two requests never log the same change twice.
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [astronautId]);
        const previous = await storedStates(tx, astronautId);
        // Crew-wide rules are shared by every astronaut's evaluation; after the astronaut's lock,
        // so the lock order is always the same and two evaluations cannot deadlock.
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CREW_LOCK]);
        const crewPrevious = await crewStates(tx);
        const { changes, states, crewStates: crewNext } = compute(previous, crewPrevious);
        for (const [key, status] of crewNext) {
          await tx.query(
            `INSERT INTO crew_rule_state (subject_key, status) VALUES ($1, $2)
             ON CONFLICT (subject_key) DO UPDATE SET status = excluded.status`,
            [key, status],
          );
        }
        await tx.query("DELETE FROM status_state WHERE astronaut_id = $1", [astronautId]);
        for (const [key, state] of states) {
          await tx.query(
            "INSERT INTO status_state (astronaut_id, subject_key, subject, status, title) VALUES ($1, $2, $3, $4, $5)",
            [astronautId, key, JSON.stringify(state.subject), state.status, state.title],
          );
        }
        for (const change of changes) {
          await tx.query(
            `INSERT INTO status_log (astronaut_id, at_ms, subject, from_status, to_status, title, message, ground_unsent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [astronautId, Date.parse(change.at), JSON.stringify(change.subject), change.from, change.to, change.title,
              change.message === null ? null : JSON.stringify(change.message), change.relayToGround],
          );
        }
        return changes;
      });
    },

    async between(astronautId, fromMs, toMs, area) {
      const { rows } = await pool.query<LogRow>(
        `SELECT id, astronaut_id, at_ms, subject, from_status, to_status, title, message FROM status_log
         WHERE astronaut_id = $1 AND at_ms BETWEEN $2 AND $3 AND ($4::text IS NULL OR subject->>'area' = $4)
         ORDER BY at_ms, id`,
        [astronautId, fromMs, toMs, area ?? null],
      );
      return rows.map(toAlertLogEntry);
    },

    async unsentGroundAlerts() {
      const { rows } = await pool.query<LogRow>(
        `SELECT id, astronaut_id, at_ms, subject, from_status, to_status, title, message FROM status_log
         WHERE ground_unsent ORDER BY at_ms, id`,
      );
      return rows.map((row) => ({
        ...toAlertLogEntry(row),
        astronautId: row.astronaut_id,
        crewWide: row.subject.kind === "rule" && row.subject.crewWide === true,
      }));
    },

    async markSentToGround(logId) {
      await pool.query("UPDATE status_log SET ground_unsent = false WHERE id::text = $1", [logId]);
    },
  };
}

const CREW_LOCK = "status-log:crew";

async function crewStates(db: Queryable): Promise<Map<string, Status>> {
  const { rows } = await db.query<{ subject_key: string; status: Status }>("SELECT subject_key, status FROM crew_rule_state");
  return new Map(rows.map((row) => [row.subject_key, row.status]));
}

async function storedStates(db: Queryable, astronautId: string): Promise<Map<string, StoredSubject>> {
  const { rows } = await db.query<StateRow>(
    "SELECT subject_key, subject, status, title FROM status_state WHERE astronaut_id = $1", [astronautId],
  );
  return new Map(rows.map((row) => [row.subject_key, { subject: row.subject, status: row.status, title: row.title }]));
}

function toAlertLogEntry(row: LogRow): AlertLogEntry {
  const { subject } = row;
  const isRule = subject.kind === "rule";
  return {
    id: String(row.id),
    at: new Date(row.at_ms).toISOString(),
    area: subject.area,
    metric: isRule && subject.metrics.length === 1 ? subject.metrics[0] : null,
    ruleId: isRule ? subject.ruleId : null,
    title: row.title,
    from: row.from_status,
    to: row.to_status,
    message: row.message,
  };
}
