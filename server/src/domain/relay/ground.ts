// The ground side (SPEC §3, §9.2): Mission Control sees only what the relay has delivered, and
// everything it sends (acknowledgments, notes, crew changes) goes back through the relay.
import type {
  AlertStateChange, CrewChange, FailedCrewChange, GroundAlert, GroundAlertState, GroundCrewResponse, GroundNote, PendingCrewChange,
  RelayDelayResponse, RelayEventOf, RosterEntry, SurgeonNote,
} from "@heartbeat/shared";
import type { RelayReader } from "../ports.ts";
import type { TimeBounds } from "../time-windows.ts";
import { applyToRoster, crewChangeProblem, type CrewChangeProblem } from "./crew.ts";
import { failed, succeeded, type Outcome } from "./outcome.ts";
import { latestByKey, type RelaySides } from "./sides.ts";

/** What the ground has heard about the crew: the last roster, the changes it sent, and failure reports. */
export interface CrewKnowledge {
  roster: RelayEventOf<"roster"> | null;
  changes: readonly RelayEventOf<"crewChange">[];
  failures: readonly RelayEventOf<"deliveryFailure">[];
}

const failedChangeIds = ({ failures }: CrewKnowledge) =>
  new Set(failures.filter((f) => f.payload.kind === "crewChange").map((f) => f.payload.eventId));

/** Crew changes neither confirmed by the last roster nor reported failed. */
export function pendingCrewChanges(knowledge: CrewKnowledge): PendingCrewChange[] {
  const lastApplied = knowledge.roster?.payload.lastAppliedChangeSeq ?? null;
  const failedIds = failedChangeIds(knowledge);
  return knowledge.changes
    .filter((event) => (lastApplied === null || event.seq > lastApplied) && !failedIds.has(event.id))
    .map((event) => ({ changeId: event.id, change: event.payload, sentAt: event.sentAt, arrivesOnboardAt: event.deliverAt }));
}

/** Crew changes the spacecraft reported it could not apply. */
export function failedCrewChanges({ changes, failures }: CrewKnowledge): FailedCrewChange[] {
  const changeById = new Map(changes.map((event) => [event.id, event]));
  return failures.flatMap((failure) => {
    const change = changeById.get(failure.payload.eventId);
    if (!change) return [];
    return [{ changeId: change.id, change: change.payload, reason: failure.payload.reason, receivedAt: failure.deliverAt }];
  });
}

/** The crew as the ground expects it: the last roster received plus the changes still on their way. */
export function expectedRoster(knowledge: CrewKnowledge): RosterEntry[] {
  return pendingCrewChanges(knowledge)
    .reduce((entries, { change }) => applyToRoster(entries, change), knowledge.roster?.payload.astronauts ?? []);
}

/** The crew grid from the last roster and the latest status snapshot of each astronaut in it. */
export function groundCrewView(
  knowledge: CrewKnowledge, snapshots: readonly RelayEventOf<"status">[], relay: RelayDelayResponse,
): GroundCrewResponse {
  const snapshotFor = latestByKey(snapshots, (event) => event.payload.astronautId);
  const crew = (knowledge.roster?.payload.astronauts ?? []).map((entry) => {
    const snapshot = snapshotFor.get(entry.astronautId);
    return { ...entry, status: snapshot?.payload ?? null, receivedAt: snapshot?.deliverAt ?? null };
  });
  const asOf = crew.flatMap((member) => (member.status ? [member.status.at] : [])).sort().at(-1) ?? null;
  return {
    relay,
    dataAsOf: asOf,
    crew,
    unassignedWatches: knowledge.roster?.payload.unassignedWatches ?? [],
    pendingChanges: pendingCrewChanges(knowledge),
    failedChanges: failedCrewChanges(knowledge),
  };
}

/** An alert as the surgeon's feed shows it, with the surgeon's latest handling of it. */
export function groundAlertView(alert: RelayEventOf<"alert">, handling: RelayEventOf<"alertState"> | undefined): GroundAlert {
  return {
    alertId: alert.id,
    ...alert.payload,
    sentAt: alert.sentAt,
    receivedAt: alert.deliverAt,
    lagMs: Date.parse(alert.deliverAt) - Date.parse(alert.sentAt),
    state: handling?.payload.state ?? "new",
    stateChangedAt: handling?.sentAt ?? null,
  };
}

/** How the surgeon may move an alert along: acknowledge a new one, resolve a new or acknowledged one. */
const NEXT_STATES: Record<GroundAlertState, readonly AlertStateChange["state"][]> = {
  new: ["acknowledged", "resolved"],
  acknowledged: ["resolved"],
  resolved: [],
};

export function canMoveAlert(from: GroundAlertState, to: AlertStateChange["state"]): boolean {
  return NEXT_STATES[from].includes(to);
}

export function groundSide({ store, relay, now }: RelaySides) {
  async function crewKnowledge(queue: RelayReader): Promise<CrewKnowledge> {
    const [roster, changes, failures] = await Promise.all([
      queue.latestDelivered("roster", now()), queue.list("crewChange"), queue.list("deliveryFailure", { deliveredByMs: now() }),
    ]);
    return { roster, changes, failures };
  }

  async function handlingsByAlert(queue: RelayReader, astronautId?: string) {
    const handlings = await queue.list("alertState", { astronautId });
    return latestByKey(handlings, (event) => event.payload.alertId);
  }

  /** An alert that has reached the ground, or null. */
  async function arrivedAlert(queue: RelayReader, alertId: string) {
    const alert = await queue.find("alert", alertId);
    return alert && Date.parse(alert.deliverAt) <= now() ? alert : null;
  }

  return {
    /** GET /api/ground/crew: the crew grid from delivered data only. */
    async crew(): Promise<GroundCrewResponse> {
      const [knowledge, snapshots, delay] = await Promise.all([
        crewKnowledge(store), store.latestDeliveredPerAstronaut("status", now()), relay.delay(),
      ]);
      return groundCrewView(knowledge, snapshots, delay);
    },

    /** Sends a crew or watch change, judged against the crew as the ground expects it. */
    changeCrew(change: CrewChange): Promise<Outcome<RelayEventOf<"crewChange">, CrewChangeProblem>> {
      return relay.sendChecked("crewChange", async (queue) => {
        const problem = crewChangeProblem(expectedRoster(await crewKnowledge(queue)), change);
        return problem ? failed(problem) : succeeded({ send: change });
      });
    },

    /** The alert feed: 🔴 and 🟡 alerts that have arrived, sent in the range, in order of arrival. */
    async alerts(range: TimeBounds): Promise<GroundAlert[]> {
      const [alerts, handlings] = await Promise.all([
        store.list("alert", { deliveredByMs: now(), sentFromMs: range.fromMs, sentToMs: range.toMs }),
        handlingsByAlert(store),
      ]);
      return alerts.map((alert) => groundAlertView(alert, handlings.get(alert.id)));
    },

    /** Acknowledges or resolves an alert; the crew learns of it after the delay. */
    handleAlert(
      alertId: string, state: AlertStateChange["state"],
    ): Promise<Outcome<RelayEventOf<"alertState">, "unknown_alert" | "invalid_transition">> {
      return relay.sendChecked("alertState", async (queue) => {
        const alert = await arrivedAlert(queue, alertId);
        if (!alert) return failed("unknown_alert");
        const { astronautId } = alert.payload;
        const current = (await handlingsByAlert(queue, astronautId)).get(alertId)?.payload.state ?? "new";
        if (!canMoveAlert(current, state)) return failed("invalid_transition");
        return succeeded({ send: { alertId, astronautId, state } });
      });
    },

    /** Sends a note to an astronaut the ground expects on board, optionally answering an alert of theirs. */
    sendNote(note: SurgeonNote): Promise<Outcome<RelayEventOf<"note">, "unknown_astronaut" | "unknown_alert">> {
      return relay.sendChecked("note", async (queue) => {
        const expected = expectedRoster(await crewKnowledge(queue));
        if (!expected.some((entry) => entry.astronautId === note.astronautId)) return failed("unknown_astronaut");
        if (note.alertId !== null) {
          const alert = await arrivedAlert(queue, note.alertId);
          const aboutThem = alert && (alert.payload.crewWide || alert.payload.astronautId === note.astronautId);
          if (!aboutThem) return failed("unknown_alert");
        }
        return succeeded({ send: note });
      });
    },

    /** The notes the surgeon sent, with read receipts that have reached the ground. */
    async notes(astronautId?: string): Promise<GroundNote[]> {
      const [notes, receipts] = await Promise.all([
        store.list("note", { astronautId }),
        store.list("readReceipt", { astronautId, deliveredByMs: now() }),
      ]);
      const receiptFor = latestByKey(receipts, (event) => event.payload.noteId);
      return notes.map((note) => {
        const receipt = receiptFor.get(note.id);
        return {
          noteId: note.id, ...note.payload, sentAt: note.sentAt, deliverAt: note.deliverAt,
          readAt: receipt?.payload.readAt ?? null, readReceiptReceivedAt: receipt?.deliverAt ?? null,
        };
      });
    },
  };
}

export type GroundSide = ReturnType<typeof groundSide>;
