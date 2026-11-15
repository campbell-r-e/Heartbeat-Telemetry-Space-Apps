// The alert log (owner decision): every change of an area's status, and every rule starting or
// stopping to fire, recorded with the time it was seen. Feeds the detail pages' history and the
// flight surgeon's alert feed (its 🔴 and 🟡 rule changes are relayed, SPEC §8). Pure: comparing
// two snapshots gives the changes.
import type { Area, AstronautStatus, FiringStatus, Metric, Status, StatusMessage } from "@heartbeat/shared";

/** What a logged change is about: an area's own status, or one rule. */
export type StatusChangeSubject =
  | { kind: "area"; area: Area }
  /** crewWide is absent on states stored before it existed; absent means false. */
  | { kind: "rule"; ruleId: string; area: Area; metrics: Metric[]; crewWide?: boolean };

/** A subject's current state and how to describe a change to it. */
export interface SubjectState {
  key: string;
  subject: StatusChangeSubject;
  status: Status | null;
  title: string;
  message: StatusMessage | null;
}

/** A change seen by comparing two snapshots. */
export interface StatusChange {
  astronautId: string;
  /** ISO time of the evaluation that saw the change. */
  at: string;
  subject: StatusChangeSubject;
  from: Status | null;
  to: Status | null;
  title: string;
  message: StatusMessage | null;
}

/** A change to store; the store turns it into an AlertLogEntry. */
export interface NewStatusChange extends StatusChange {
  /**
   * True for a rule that starts firing at 🔴 or 🟡 (or moves between them): it goes to the
   * ground's alert feed. Only 🔴 is the automatic flight-surgeon notification (SPEC §6.1).
   */
  relayToGround: boolean;
}

const AREA_NAMES: Record<Area, string> = {
  vitals: "Vitals", radiation: "Radiation", gravity: "Gravity", cabin: "Cabin", nutrition: "Nutrition", mind: "Mind",
};
const STATUS_WORDS: Record<Status, string> = { normal: "normal", watch: "watch", alert: "alert" };

/** A rule that is not firing is "normal" (it may still lack data); its first firing is a change from "normal". */
const NOT_FIRING: Status = "normal";

export const areaKey = (area: Area) => `area:${area}`;
export const ruleKey = (ruleId: string) => `rule:${ruleId}`;

/** Every area's status and every firing rule, as the log compares them. */
export function subjectStates(status: AstronautStatus): SubjectState[] {
  const areas = status.areas.map((a): SubjectState => ({
    key: areaKey(a.area),
    subject: { kind: "area", area: a.area },
    status: a.status,
    title: `${AREA_NAMES[a.area]}: ${a.status === null ? "no status" : STATUS_WORDS[a.status]}`,
    message: null,
  }));
  const rules = status.evaluations.map((e): SubjectState => ({
    key: ruleKey(e.ruleId),
    subject: { kind: "rule", ruleId: e.ruleId, area: e.area, metrics: e.metrics, crewWide: e.crewWide },
    status: e.status,
    title: e.title,
    message: e.message,
  }));
  return [...areas, ...rules];
}

/**
 * The changes from `previous` (stored states by key) to `current`. An area never seen before
 * counts as having had no status; a rule missing from `current` has stopped firing.
 */
export function statusChanges(
  astronautId: string, at: string, previous: ReadonlyMap<string, StoredSubject>, current: readonly SubjectState[],
): StatusChange[] {
  const changes: StatusChange[] = [];
  const seen = new Set<string>();
  for (const state of current) {
    seen.add(state.key);
    const before = previous.get(state.key)?.status ?? (state.subject.kind === "rule" ? NOT_FIRING : null);
    if (before === state.status) continue;
    changes.push({ astronautId, at, subject: state.subject, from: before, to: state.status, title: state.title, message: state.message });
  }
  for (const [key, stored] of previous) {
    if (seen.has(key) || stored.subject.kind !== "rule" || stored.status === NOT_FIRING) continue;
    changes.push({ astronautId, at, subject: stored.subject, from: stored.status, to: NOT_FIRING, title: `${stored.title}: cleared`, message: null });
  }
  return changes;
}

/** A status a firing rule can have: 🟡 or 🔴. */
export const isFiring = (status: Status | null): status is FiringStatus => status === "watch" || status === "alert";

/**
 * Marks which changes go to the ground: every rule change to 🔴 or 🟡. A crew-wide rule (ship
 * sensors) goes once for the whole crew: only the first evaluation of any astronaut that sees its
 * crew-level status change sends it. `crewPrevious` holds those crew-level statuses; the
 * returned `crewStates` are the ones to store.
 */
export function markGroundRelay(
  changes: readonly StatusChange[], crewPrevious: ReadonlyMap<string, Status>,
): { changes: NewStatusChange[]; crewStates: Map<string, Status> } {
  const crewStates = new Map<string, Status>();
  const marked = changes.map((change): NewStatusChange => {
    const { subject } = change;
    if (subject.kind !== "rule") return { ...change, relayToGround: false };
    if (subject.crewWide !== true) return { ...change, relayToGround: isFiring(change.to) };
    const key = ruleKey(subject.ruleId);
    const to = change.to ?? NOT_FIRING;
    const crewBefore = crewStates.get(key) ?? crewPrevious.get(key) ?? NOT_FIRING;
    if (crewBefore === to) return { ...change, relayToGround: false };
    crewStates.set(key, to);
    return { ...change, relayToGround: isFiring(to) };
  });
  return { changes: marked, crewStates };
}

/** What the store keeps per subject between evaluations. */
export interface StoredSubject {
  subject: StatusChangeSubject;
  status: Status | null;
  title: string;
}

/** The states to store after `current`: firing rules and every area; stopped rules are dropped. */
export function statesToStore(current: readonly SubjectState[]): Map<string, StoredSubject> {
  return new Map(current.map((s) => [s.key, { subject: s.subject, status: s.status, title: s.title }]));
}
