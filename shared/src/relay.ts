// The relay between the spacecraft ("onboard") and Mission Control ("ground") (SPEC §3, §8, §9.2):
// every event that crosses it is held until sentAt + the one-way delay. Re-exported from index.ts.
import type {
  Area, AreaStatus, AstronautStatus, CheckIn, ExerciseDay, Metric, MissionResponse, PointsSummary, SeriesResponse, Sex, Status, StatusMessage,
} from "./index";

/** Mission delay presets (SPEC §8), in selector order. */
export const DELAY_PRESETS = ["iss", "moon", "marsClose", "marsFar"] as const;
export type DelayPreset = (typeof DELAY_PRESETS)[number];

/** The relay setting stored in the mission record. */
export interface RelaySetting {
  preset: DelayPreset;
  /** True shows the true one-way delay; false the demo setting (Mars scaled down to seconds). */
  realTime: boolean;
}

/** One preset's delays, so clients show them without typing numbers. */
export interface DelayPresetInfo {
  preset: DelayPreset;
  label: string;
  /** The true one-way light delay. */
  realDelayMs: number;
  /** The delay used while "real time" is off. */
  demoDelayMs: number;
}

/** GET and PUT /api/relay/delay: the setting, the delay it gives, and every preset. */
export interface RelayDelayResponse extends RelaySetting {
  label: string;
  /** The one-way delay events sent now are held for. */
  oneWayDelayMs: number;
  presets: DelayPresetInfo[];
}

/** Which way an event travels. */
export type RelayDirection = "toGround" | "toOnboard";

/** The latest onboard verdict for one astronaut, as the ground's crew grid shows it. */
export interface StatusSnapshot {
  astronautId: string;
  /** ISO time the status was evaluated on board ("data as of"). */
  at: string;
  overall: Status | null;
  areas: AreaStatus[];
}

/** The statuses a firing rule can have: 🟡 watch or 🔴 alert. */
export type FiringStatus = Extract<Status, "watch" | "alert">;

/**
 * A rule that started firing at 🔴 or 🟡, for the ground's alert feed (All / Alert / Watch).
 * Only `status: "alert"` is the automatic flight-surgeon notification (SPEC §6.1).
 */
export interface RelayedAlert {
  /** The alert log entry that recorded it (GET /api/astronauts/:id/alerts). */
  alertLogId: string;
  astronautId: string;
  ruleId: string;
  title: string;
  area: Area;
  /** The rule's metric when it reads exactly one, as in the alert log. */
  metric: Metric | null;
  status: FiringStatus;
  /** A rule on the ship's own sensors: one alert for the whole crew, not one per astronaut. */
  crewWide: boolean;
  /** What the astronaut was told. */
  message: StatusMessage | null;
  /** ISO time of the evaluation that saw the alert. */
  at: string;
}

/** How the flight surgeon has handled an alert. "new" until acknowledged or resolved. */
export type GroundAlertState = "new" | "acknowledged" | "resolved";

/** The flight surgeon acknowledged or resolved an alert; travels back to the crew. */
export interface AlertStateChange {
  alertId: string;
  astronautId: string;
  state: Exclude<GroundAlertState, "new">;
}

/** A note from the flight surgeon to one astronaut. */
export interface SurgeonNote {
  astronautId: string;
  text: string;
  /** The alert the note answers, or null. */
  alertId: string | null;
}

/** The astronaut read a note; travels back to the ground. */
export interface ReadReceipt {
  noteId: string;
  astronautId: string;
  /** ISO time the astronaut marked it read. */
  readAt: string;
}

/** Profile fields the flight surgeon can give a new astronaut; each optional field unknown when omitted. */
export interface NewAstronaut {
  id: string;
  name: string;
  age: number | null;
  sex: Sex | null;
  massKg: number | null;
  heightM: number | null;
}

/** A crew or watch change made on the ground; it takes effect on board after the delay (SPEC §9.2). */
export type CrewChange =
  | { action: "addAstronaut"; astronaut: NewAstronaut }
  | { action: "removeAstronaut"; astronautId: string }
  | { action: "assignWatch"; astronautId: string; watchId: string }
  | { action: "unassignWatch"; astronautId: string };

/** A watch as the crew roster reports it, from the `device` the watch sends with its uploads. */
export interface WatchInfo {
  watchId: string;
  /** ISO time of the latest accepted upload from the watch; null before its first. */
  lastContactAt: string | null;
  /** Battery level the watch last reported, 0–100; null when it did not say. */
  batteryPct: number | null;
}

export interface RosterEntry {
  astronautId: string;
  name: string;
  watch: WatchInfo | null;
}

/** The crew as the spacecraft has it, sent to the ground on start and after each crew change. */
export interface CrewRoster {
  astronauts: RosterEntry[];
  /** Watches that have registered (by uploading) but are assigned to no one. */
  unassignedWatches: WatchInfo[];
  /** The `seq` of the last crew change applied on board, or null when none has been. */
  lastAppliedChangeSeq: number | null;
}

/**
 * An event that could not take effect on board after several attempts (SPEC §8): it is set aside
 * so later events flow, and the ground is told.
 */
export interface DeliveryFailure {
  /** The failed event's id (for a crew change, its changeId). */
  eventId: string;
  kind: RelayEventKind;
  /** The last attempt's error. */
  reason: string;
  attempts: number;
}

/** One UTC day's calories from the meal log, counted on board from the menu (SPEC §5.5). */
export interface DailyCalories {
  /** "YYYY-MM-DD", UTC. */
  day: string;
  /** The day's calories; a meal whose food has no published kcal counts as 0, so it is a lower bound when mealsWithoutKcal > 0. */
  kcalAtLeast: number;
  mealsLogged: number;
  /** Meals whose food has no published calorie value. */
  mealsWithoutKcal: number;
}

/**
 * An astronaut's daily logs since mission day 1, as the spacecraft has them, for the surgeon's
 * charts (SPEC §9.2): mood and stress check-ins, calories per day and exercise minutes per day.
 * Sent to the ground whenever it changes.
 */
export interface DailyLog {
  astronautId: string;
  /** ISO time it was read on board ("data as of"). */
  at: string;
  /** Check-ins since mission day 1, oldest first. */
  checkIns: CheckIn[];
  /** Days with meals logged since mission day 1, oldest first. */
  calories: DailyCalories[];
  /** Every UTC day since mission day 1, oldest first, counted as GET /api/astronauts/:id/exercise/daily counts them. */
  exercise: ExerciseDay[];
}

/** Each relay event kind and its payload. */
export interface RelayPayloads {
  status: StatusSnapshot;
  alert: RelayedAlert;
  readReceipt: ReadReceipt;
  roster: CrewRoster;
  mission: MissionResponse;
  dailyLog: DailyLog;
  deliveryFailure: DeliveryFailure;
  alertState: AlertStateChange;
  note: SurgeonNote;
  crewChange: CrewChange;
}

export type RelayEventKind = keyof RelayPayloads;

/** Each kind travels one way only. */
export const RELAY_DIRECTIONS: Record<RelayEventKind, RelayDirection> = {
  status: "toGround",
  alert: "toGround",
  readReceipt: "toGround",
  roster: "toGround",
  mission: "toGround",
  dailyLog: "toGround",
  deliveryFailure: "toGround",
  alertState: "toOnboard",
  note: "toOnboard",
  crewChange: "toOnboard",
};

/** One event in the relay queue, held until deliverAt. */
export interface RelayEventOf<K extends RelayEventKind> {
  id: string;
  kind: K;
  direction: RelayDirection;
  /** Its place in its direction's send order: 1, 2, 3, ... */
  seq: number;
  payload: RelayPayloads[K];
  /** ISO time it left its side. */
  sentAt: string;
  /** ISO time it arrives on the other side: sentAt + the one-way delay, never before an earlier event in the same direction. */
  deliverAt: string;
}

/** Any relay event; narrow it by `kind`. */
export type RelayEvent = { [K in RelayEventKind]: RelayEventOf<K> }[RelayEventKind];

/** GET /api/ground/crew: one astronaut as the ground last heard. */
export interface GroundCrewMember extends RosterEntry {
  /** The latest status snapshot that has arrived; null before the first one. */
  status: StatusSnapshot | null;
  /** ISO time that snapshot arrived on the ground; null with no snapshot. */
  receivedAt: string | null;
}

/** A crew change the ground sent whose result has not come back in a roster yet. */
export interface PendingCrewChange {
  changeId: string;
  change: CrewChange;
  sentAt: string;
  /** When it takes effect on board; the roster confirming it arrives one delay later. */
  arrivesOnboardAt: string;
}

/** A crew change that could not take effect on board; the ground learned of it through the relay. */
export interface FailedCrewChange {
  changeId: string;
  change: CrewChange;
  reason: string;
  /** ISO time the failure report reached the ground. */
  receivedAt: string;
}

/** GET /api/ground/crew. Ground data only: nothing newer than what the relay has delivered. */
export interface GroundCrewResponse {
  relay: RelayDelayResponse;
  /** ISO time of the newest status snapshot the ground holds ("data as of"); null before the first. */
  dataAsOf: string | null;
  crew: GroundCrewMember[];
  /** Registered watches assigned to no one, from the last roster. */
  unassignedWatches: WatchInfo[];
  pendingChanges: PendingCrewChange[];
  failedChanges: FailedCrewChange[];
}

/** GET /api/ground/mission: the mission as the ground last heard it; nulls before the first report. */
export interface GroundMissionResponse {
  mission: MissionResponse | null;
  sentAt: string | null;
  receivedAt: string | null;
}

/** GET /api/ground/astronauts/:id/daily-log: the astronaut's daily logs as their last report through the relay had them. */
export interface GroundDailyLogResponse {
  /** Null before the first report has arrived. */
  log: DailyLog | null;
  sentAt: string | null;
  receivedAt: string | null;
}

/**
 * GET /api/ground/astronauts/:id/series: chart data only up to now − the one-way delay, what
 * Mission Control can know.
 */
export interface GroundSeriesResponse extends SeriesResponse {
  /** ISO end of the data shown: now − oneWayDelayMs. */
  dataAsOf: string;
  oneWayDelayMs: number;
}

/** GET /api/ground/alerts: one 🔴 or 🟡 in the flight surgeon's feed. */
export interface GroundAlert extends RelayedAlert {
  /** The alert's relay event id; acknowledge and resolve use it. */
  alertId: string;
  /** ISO time it left the spacecraft. */
  sentAt: string;
  /** ISO time it reached the ground. */
  receivedAt: string;
  /** receivedAt − sentAt. */
  lagMs: number;
  state: GroundAlertState;
  /** ISO time of the surgeon's last acknowledge or resolve; null while new. */
  stateChangedAt: string | null;
}

/** GET /api/ground/notes: a note the surgeon sent, with what the ground knows of it. */
export interface GroundNote extends SurgeonNote {
  noteId: string;
  sentAt: string;
  /** When it reaches the astronaut. */
  deliverAt: string;
  /** When the astronaut read it, once the read receipt has reached the ground; null before. */
  readAt: string | null;
  /** When that read receipt reached the ground; null before. */
  readReceiptReceivedAt: string | null;
}

/** GET /api/astronauts/:id/notes: a note that has reached the astronaut. */
export interface OnboardNote {
  noteId: string;
  text: string;
  alertId: string | null;
  sentAt: string;
  receivedAt: string;
  /** When the astronaut marked it read; null while unread. */
  readAt: string | null;
}

/** The surgeon's latest handling of an alert, as it has reached the crew. */
export interface AlertHandling {
  state: Exclude<GroundAlertState, "new">;
  /** ISO time the surgeon acted (sent from the ground). */
  at: string;
  /** ISO time it reached the spacecraft. */
  receivedAt: string;
}

/**
 * GET /api/astronauts/:id/relayed-alerts: an alert sent to the flight surgeon, for the banner's
 * "Alert sent to flight surgeon · arrives in m:ss" countdown (deliverAt − now).
 */
export interface OnboardAlert extends RelayedAlert {
  alertId: string;
  sentAt: string;
  deliverAt: string;
  /** Null until an acknowledge or resolve from the ground has arrived. */
  handling: AlertHandling | null;
}

/** Live updates: GET /ws/onboard and /ws/ground (WebSocket), one JSON message per event. */
export type LiveMessage =
  /** An event left this side (onboard: alerts on their way, for the countdown; ground: notes and changes). */
  | { type: "relaySent"; event: RelayEvent }
  /** An event arrived on this side. */
  | { type: "relayDelivered"; event: RelayEvent }
  /** Onboard only: new readings were accepted for the astronaut (POST /api/readings). */
  | { type: "readings"; astronautId: string; metrics: Metric[] }
  /** Onboard only: a fresh verdict from the rules engine, as GET /api/astronauts/:id/status gives it. */
  | { type: "status"; status: AstronautStatus }
  /** Onboard only: the astronaut's points, streak or badges changed (a task became done or undone, a new day). */
  | { type: "points"; points: PointsSummary }
  /** Both sides: the delay setting changed. */
  | { type: "relayDelay"; relay: RelayDelayResponse };

/** Which side a live connection listens to. */
export type LiveChannel = "onboard" | "ground";
