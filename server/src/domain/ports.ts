// What the routes and the data loader need from storage. The Postgres repositories implement these.
import type {
  Astronaut, CheckIn, FoodMenu, LatestReading, MealLog, Metric, Mission, Reading, ReadingSource, ScheduledTask, SeriesPoint,
  AlertLogEntry, Area, LiveChannel, LiveMessage, RelayDirection, RelayEvent, RelayEventKind, RelayEventOf, RelayPayloads, RelaySetting, DeviceReport, WatchInfo, Status,
  BadgeId,
} from "@heartbeat/shared";
import type { NewStatusChange, StoredSubject } from "./status/status-log.ts";
import type { SeriesWindow } from "./time-windows.ts";

/** A reading plus, for replayed mission data, the time it was originally recorded. */
export type StoredReading = Reading & { originalTakenAt?: string };

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/** One astronaut's readings of one metric taken in [fromMs, toMs). */
export interface MetricRange {
  astronautId: string;
  metric: Metric;
  fromMs: number;
  toMs: number;
}

/** A reading whose value is an array (an ibi batch, an ECG recording or a wristAngle minute). */
export interface ArrayReading {
  takenAt: string;
  values: number[];
}

export interface AstronautStore {
  list(): Promise<Astronaut[]>;
  /** The astronaut, or null when the id is unknown. */
  find(id: string): Promise<Astronaut | null>;
  exists(id: string): Promise<boolean>;
  /** True for any astronaut ever in the crew, removed ones included (their history is kept). */
  hasHistory(id: string): Promise<boolean>;
  /**
   * Adds the astronaut or updates its name and profile; an existing watch assignment is kept, and
   * a removed astronaut stays removed (the bundled data loader uses this on every start).
   */
  upsert(astronaut: Astronaut): Promise<void>;
  /** Like upsert, but brings a removed astronaut back into the crew (the ground added them). */
  addToCrew(astronaut: Astronaut): Promise<void>;
  /**
   * Removes the astronaut from the crew and frees its watch; its readings and alert log are kept
   * but hidden from crew reads (list, find, exists). False when not in the crew.
   */
  remove(id: string, atMs: number): Promise<boolean>;
  /** Gives the astronaut the watch (taking it from anyone else wearing it), or none with null. */
  assignWatch(id: string, watchId: string | null): Promise<void>;
}

/** The watches that have registered themselves by uploading (SPEC §9.2). */
export interface WatchStore {
  /** Records an accepted upload from the watch at `atMs`, registering it on its first one. */
  report(device: DeviceReport, atMs: number): Promise<{ isNew: boolean }>;
  /** Every registered watch with its last contact and battery. */
  list(): Promise<WatchInfo[]>;
}

export interface ReadingStore {
  /** Inserts readings, skipping exact duplicates (same astronaut, metric, time and source). */
  add(readings: readonly StoredReading[]): Promise<InsertResult>;
  /** Inserts readings, replacing the value of any stored one with the same astronaut, metric, time and source. */
  upsert(readings: readonly StoredReading[]): Promise<number>;
  /** Atomically replaces every reading from one source for one astronaut. */
  replaceSource(astronautId: string, source: ReadingSource, readings: readonly StoredReading[]): Promise<number>;
  deleteSource(astronautId: string, source: ReadingSource): Promise<void>;
  /**
   * Chart and rule data. Simulated readings replace the recorded readings of the same metric
   * taken less than SIMULATED_READING_SPAN_MS from them (owner decision).
   */
  series(astronautId: string, metric: Metric, window: SeriesWindow): Promise<SeriesPoint[]>;
  latest(astronautId: string, nowMs: number): Promise<LatestReading[]>;
  /**
   * Array readings from one source whose span reaches into [fromMs, toMs): taken before `toMs`
   * and ending (takenAt plus the sum of the values, for ibi in ms) at or after `fromMs`. In time order.
   */
  arrayReadingsOverlapping(astronautId: string, metric: Metric, source: ReadingSource, fromMs: number, toMs: number): Promise<ArrayReading[]>;
  /** Array readings from `source` of the range's astronaut and metric taken in [fromMs, toMs), in time order (wristAngle minutes). */
  arrayReadingsTakenIn(source: ReadingSource, range: MetricRange): Promise<ArrayReading[]>;
  /** Times (ms) of the readings of a metric in [fromMs, toMs] that the rules read (rule-sources.ts), in time order. */
  readingTimesReadByRules(astronautId: string, metric: Metric, fromMs: number, toMs: number): Promise<number[]>;
  /**
   * Like `latest`, counting only the readings the rules read (rule-sources.ts), so a simulated or
   * chart-only reading never hides a newer one the rules use.
   */
  latestReadByRules(astronautId: string, nowMs: number): Promise<LatestReading[]>;
  /**
   * Atomically replaces the readings from `source` of the range's astronaut and metric taken in
   * [fromMs, toMs) with `readings` (none to just delete them).
   */
  replaceSourceInRange(source: ReadingSource, range: MetricRange, readings: readonly StoredReading[]): Promise<void>;
  /** Deletes the readings from `source` of each range's astronaut and metric taken in [fromMs, toMs). */
  deleteSourceInRanges(source: ReadingSource, ranges: readonly MetricRange[]): Promise<number>;
}

export interface FoodStore {
  /** Atomically replaces the whole menu. */
  replaceMenu(menu: FoodMenu): Promise<number>;
  menu(): Promise<FoodMenu>;
  exists(foodId: string): Promise<boolean>;
}

export interface MealStore {
  add(astronautId: string, foodId: string, eatenAt: string): Promise<MealLog>;
  /** Deletes one of the astronaut's logged meals and returns it; null when there is no such meal. */
  remove(id: number, astronautId: string): Promise<MealLog | null>;
  between(astronautId: string, fromMs: number, toMs: number): Promise<MealLog[]>;
}

export interface CheckInStore {
  add(astronautId: string, mood: number, stress: number, at: string): Promise<CheckIn>;
  /** Deletes one of the astronaut's check-ins and returns it; null when there is no such check-in. */
  remove(id: number, astronautId: string): Promise<CheckIn | null>;
  between(astronautId: string, fromMs: number, toMs: number): Promise<CheckIn[]>;
}

export interface ScheduleStore {
  /** Atomically replaces the whole schedule, so it matches `tasks` exactly. */
  replace(tasks: readonly ScheduledTask[]): Promise<number>;
  /** Tasks for this astronaut plus those for everyone, in time order. */
  forAstronaut(astronautId: string): Promise<ScheduledTask[]>;
}

export interface MissionStore {
  /** The mission settings record, or null before it is first saved. */
  get(): Promise<Mission | null>;
  /** Saves the record only when none exists yet, so later changes are kept. */
  saveIfMissing(mission: Mission): Promise<void>;
  /** Sets the sleep day's time zone; returns the updated record, or null when there is none. */
  updateSleepDayTimeZone(timeZone: string): Promise<Mission | null>;
  /** The relay delay setting stored in the mission record; null before the record exists. */
  relaySetting(): Promise<RelaySetting | null>;
  /**
   * Atomically sets the given fields of the relay setting, keeping the others; returns the new
   * setting, or null when there is no mission record.
   */
  updateRelaySetting(change: Partial<RelaySetting>): Promise<RelaySetting | null>;
}

/** The changes and the states to keep, worked out from the stored states. */
export interface StatusLogUpdate {
  changes: NewStatusChange[];
  states: Map<string, StoredSubject>;
  /** Crew-wide rules' crew-level statuses to store, by subject key. */
  crewStates: Map<string, Status>;
}

/** An alert log entry waiting in the outbox for the ground. */
export interface UnsentGroundAlert extends AlertLogEntry {
  astronautId: string;
  crewWide: boolean;
}

export interface StatusLogStore {
  /**
   * Atomically, per astronaut: reads the stored states and the crew-wide rules' crew-level
   * statuses, lets `compute` work out the changes, stores the new states and appends the changes
   * to the log (those marked `relayToGround` also to the outbox). Returns the changes.
   */
  update(
    astronautId: string,
    compute: (previous: ReadonlyMap<string, StoredSubject>, crewPrevious: ReadonlyMap<string, Status>) => StatusLogUpdate,
  ): Promise<NewStatusChange[]>;
  /** Logged changes in [fromMs, toMs], oldest first; only one area's when `area` is given. */
  between(astronautId: string, fromMs: number, toMs: number, area?: Area): Promise<AlertLogEntry[]>;
  /**
   * The outbox for the ground's alert feed: logged changes marked `relayToGround` (stored in the
   * same transaction as the log) not yet marked sent, for every astronaut, removed ones included,
   * oldest first.
   */
  unsentGroundAlerts(): Promise<UnsentGroundAlert[]>;
  markSentToGround(logId: string): Promise<void>;
}

/** Which relay events a query returns; every field narrows it. */
export interface RelayFilter {
  astronautId?: string;
  /** Only events that have arrived by then (deliverAt at or before it). */
  deliveredByMs?: number;
  /** Only events sent in [sentFromMs, sentToMs]. */
  sentFromMs?: number;
  sentToMs?: number;
}

/** Reads the relay queue. */
export interface RelayReader {
  /** One event of the kind by id, or null. */
  find<K extends RelayEventKind>(kind: K, id: string): Promise<RelayEventOf<K> | null>;
  /** Events of the kind, in arrival order (deliverAt, then send order). */
  list<K extends RelayEventKind>(kind: K, filter?: RelayFilter): Promise<RelayEventOf<K>[]>;
  /** The latest event of the kind that has arrived by `nowMs`, or null. */
  latestDelivered<K extends RelayEventKind>(kind: K, nowMs: number): Promise<RelayEventOf<K> | null>;
  /** The latest arrived event of the kind for each astronaut. */
  latestDeliveredPerAstronaut<K extends RelayEventKind>(kind: K, nowMs: number): Promise<RelayEventOf<K>[]>;
}

/** The relay queue while one direction's sending is locked (see RelayStore.inDirection). */
export interface RelaySender extends RelayReader {
  /**
   * Stores an event sent at `sentAtMs`, with the next `seq` of its direction; `deliverAt` turns
   * the latest deliverAt in that direction (null when there is none) into this event's.
   */
  append<K extends RelayEventKind>(
    kind: K, payload: RelayPayloads[K], sentAtMs: number, deliverAt: (previousDeliverAtMs: number | null) => number,
  ): Promise<RelayEventOf<K>>;
}

/** The relay queue (SPEC §3): every event that crosses between the spacecraft and the ground. */
export interface RelayStore extends RelayReader {
  /**
   * Runs `work` in one transaction holding the direction's send lock, so a check and the append
   * it guards see no other sender in that direction in between. Commits when `work` resolves.
   */
  inDirection<T>(direction: RelayDirection, work: (queue: RelaySender) => Promise<T>): Promise<T>;
  /** The handed-over event of the kind with the highest `seq`, or null. */
  latestHandedOver<K extends RelayEventKind>(kind: K): Promise<RelayEventOf<K> | null>;
  /** Counts a failed hand-over attempt and holds the event (and every later one) until `retryAtMs`. */
  recordFailedAttempt(id: string, retryAtMs: number): Promise<void>;
  /** Sets the event aside as failed: it is no longer due. */
  markFailed(id: string, atMs: number): Promise<void>;
  /**
   * Deletes handed-over events of the kind that arrived before `beforeMs`, keeping each
   * astronaut's latest handed-over one (the newest the other side can read), however old.
   */
  pruneHandedOver(kind: RelayEventKind, beforeMs: number): Promise<number>;
  /** Events due by `nowMs` that have been neither handed over nor set aside as failed, in arrival order. */
  dueUndelivered(nowMs: number): Promise<DueEvent[]>;
  markDelivered(id: string, atMs: number): Promise<void>;
  /** The earliest deliverAt after `afterMs` among events still waiting; null when none. */
  nextDeliverAtMs(afterMs: number): Promise<number | null>;
}

/** An event due for hand-over, with its failed attempts so far and when it may be tried again. */
export interface DueEvent {
  event: RelayEvent;
  failedAttempts: number;
  /** Null until an attempt has failed. */
  retryAtMs: number | null;
}

/** Pushes live updates to the clients listening on a side (SPEC §10 /ws/onboard, /ws/ground). */
export interface LiveUpdates {
  publish(channel: LiveChannel, message: LiveMessage): void;
}

/**
 * Told when a write lands on a UTC day of an astronaut's daily log (a check-in or meal added or
 * removed, heart-rate readings uploaded), so the next run rebuilds that day too (SPEC §8).
 */
export interface DailyLogChanges {
  dayChanged(astronautId: string, atMs: number): void;
  /** The astronaut's whole history may read differently (removed, added again, a new profile): rebuild it all. */
  historyChanged(astronautId: string): void;
}

/**
 * Told when a write may have completed or undone one of an astronaut's tasks, so the days it
 * touches are worked out again and the points pushed live (SPEC §7).
 */
export interface PointsChanges {
  /** A meal, check-in, ECG, SpO₂ or heart-rate reading at `atMs` was added or removed. */
  activityChanged(astronautId: string, atMs: number): void;
  /** Every day may read differently (removed or added again, a new profile). */
  historyChanged(astronautId: string): void;
}

/** A badge an astronaut has earned and the UTC day ("YYYY-MM-DD") it was earned. */
export interface EarnedBadge {
  badgeId: BadgeId;
  earnedOn: string;
}

/** Badges are stored once earned and never removed (SPEC §7, owner decision). */
export interface BadgeStore {
  /** The astronaut's stored badges. */
  earned(astronautId: string): Promise<EarnedBadge[]>;
  /**
   * Stores the badges not stored yet (a stored one keeps its day) and returns every stored badge
   * of the astronaut afterwards.
   */
  record(astronautId: string, badges: readonly EarnedBadge[], atMs: number): Promise<EarnedBadge[]>;
}

/** One stored simulated storm reading: its time and dose rate (µGy/h). */
export interface StormReading {
  takenMs: number;
  value: number;
}

/**
 * The labeled simulated demo storm (SPEC §5.7, §13): the ship's `simulated` radiation readings and
 * when the latest storm started. Each write is one transaction, so a start time is never stored
 * without its readings.
 */
export interface DemoStormStore {
  /** The stored storm readings, in time order, and when the latest storm started (null when unknown or forgotten). */
  read(): Promise<{ readings: StormReading[]; startedMs: number | null }>;
  /** Replaces the storm's readings and records `startedMs` as its start, together. */
  store(readings: readonly StoredReading[], startedMs: number): Promise<void>;
  /** Removes the storm's readings; the start time is kept, so the reset can still find its alerts. */
  clear(): Promise<void>;
  /** Forgets the latest storm's start time, once the reset has handled its alerts. */
  forgetStart(): Promise<void>;
}

export interface Stores {
  astronauts: AstronautStore;
  badges: BadgeStore;
  readings: ReadingStore;
  foods: FoodStore;
  meals: MealStore;
  checkIns: CheckInStore;
  schedule: ScheduleStore;
  mission: MissionStore;
  statusLog: StatusLogStore;
  relay: RelayStore;
  watches: WatchStore;
  demoStorm: DemoStormStore;
}
