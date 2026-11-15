// The spacecraft's view of the relay (SPEC §9.1, §9.3): notes that have arrived from the flight
// surgeon, read receipts going back, and the alerts sent to the ground with their arrival times.
import type { OnboardAlert, OnboardNote, RelayEventOf } from "@heartbeat/shared";
import type { RelayReader } from "../ports.ts";
import { failed, succeeded, type Outcome } from "./outcome.ts";
import { latestByKey, type RelaySides } from "./sides.ts";
import type { TimeBounds } from "../time-windows.ts";

export function onboardSide({ store, relay, now }: RelaySides) {
  async function receiptsFor(queue: RelayReader, astronautId: string) {
    return latestByKey(await queue.list("readReceipt", { astronautId }), (event) => event.payload.noteId);
  }

  return {
    /** The notes that have reached the astronaut, oldest first, with when each was read. */
    async notes(astronautId: string): Promise<OnboardNote[]> {
      const [notes, receipts] = await Promise.all([
        store.list("note", { astronautId, deliveredByMs: now() }),
        receiptsFor(store, astronautId),
      ]);
      return notes.map((note) => ({
        noteId: note.id, text: note.payload.text, alertId: note.payload.alertId,
        sentAt: note.sentAt, receivedAt: note.deliverAt, readAt: receipts.get(note.id)?.payload.readAt ?? null,
      }));
    },

    /**
     * Marks an arrived note read and sends the read receipt to the ground. Marking it again
     * returns the receipt already sent.
     */
    markNoteRead(astronautId: string, noteId: string): Promise<Outcome<RelayEventOf<"readReceipt">, "unknown_note">> {
      return relay.sendChecked("readReceipt", async (queue) => {
        const note = await queue.find("note", noteId);
        if (!note || note.payload.astronautId !== astronautId || Date.parse(note.deliverAt) > now()) {
          return failed("unknown_note");
        }
        const sent = (await receiptsFor(queue, astronautId)).get(noteId);
        return succeeded(sent ? { alreadySent: sent } : { send: { noteId, astronautId, readAt: new Date(now()).toISOString() } });
      });
    },

    /**
     * The astronaut's alerts (and the crew-wide ones) sent to the ground in the range, with when each arrives (for the
     * banner countdown) and the surgeon's latest handling that has reached the spacecraft.
     */
    async relayedAlerts(astronautId: string, range: TimeBounds): Promise<OnboardAlert[]> {
      // A crew-wide alert is sent once, under the astronaut whose evaluation saw it first.
      const [sentInRange, handlings] = await Promise.all([
        store.list("alert", { sentFromMs: range.fromMs, sentToMs: range.toMs }),
        store.list("alertState", { deliveredByMs: now() }),
      ]);
      const alerts = sentInRange.filter((alert) => alert.payload.astronautId === astronautId || alert.payload.crewWide);
      const handlingFor = latestByKey(handlings, (event) => event.payload.alertId);
      return alerts.map((alert) => {
        const handling = handlingFor.get(alert.id);
        return {
          alertId: alert.id, ...alert.payload, sentAt: alert.sentAt, deliverAt: alert.deliverAt,
          handling: handling ? { state: handling.payload.state, at: handling.sentAt, receivedAt: handling.deliverAt } : null,
        };
      });
    },
  };
}

export type OnboardSide = ReturnType<typeof onboardSide>;
