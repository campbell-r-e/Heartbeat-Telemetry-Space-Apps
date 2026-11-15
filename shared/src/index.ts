// Types shared by the server, the web app and (by contract) the watch app.
// See SPEC.md §10. The watch app mirrors these shapes in Kotlin.

export type Status = "normal" | "watch" | "alert";

export type Hazard = "radiation" | "isolation" | "distance" | "gravity" | "environment";

/** The six areas shown as dashboard cards and watch dots, in display order. */
export const AREAS = ["vitals", "radiation", "gravity", "cabin", "nutrition", "mind"] as const;

export type Area = (typeof AREAS)[number];

/** Every metric the app stores. The Metric type is derived from this list. */
export const METRICS = [
  "heartRate",
  "spo2",
  "skinTemp",
  "hrv",
  /**
   * Raw beat-to-beat intervals from the watch (invalid ones already dropped), one array per batch
   * with takenAt = the first beat; the server derives hrv from them.
   */
  "ibi",
  "ecg",
  "pressure",
  "noise",
  "bodyComposition",
  /**
   * Hours asleep per night, stamped at the wake time. For the Galaxy Watch the server derives it
   * from wristAngle (SPEC §5.7, van Hees et al. 2018); the Zepp history has its own nights.
   */
  "sleep",
  /**
   * The wrist's z-angle in degrees, one array of 12 five-second epoch means per minute with
   * takenAt = the minute's start; the server detects sleep from it (SPEC §5.1, §5.7).
   */
  "wristAngle",
  "radiationDoseRate",
  "co2",
  "cabinTemp",
  "humidity",
] as const;

export type Metric = (typeof METRICS)[number];

/**
 * Where a reading came from. There is no made-up data: "simulated" is used only for the
 * labeled deep-space solar storm demo button and is always shown as simulated in the UI.
 * "zepp" is Astronaut 1's imported Zepp OS watch history (SPEC §5.7). READING_SOURCE_LABELS
 * names each source to people.
 */
export type ReadingSource = "watch" | "wxserver" | "zepp" | "radlab" | "osdr" | "manual" | "simulated";

/** How each reading source is named to people, in every client (owner decision). */
export const READING_SOURCE_LABELS = {
  watch: "Galaxy Watch",
  wxserver: "Galaxy Watch history",
  zepp: "Zepp watch",
  radlab: "ship data",
  osdr: "ship data",
  manual: "manual",
  simulated: "simulated",
} as const satisfies Record<ReadingSource, string>;

export interface Reading {
  astronautId: string;
  metric: Metric;
  /** number[] for the ECG waveform, ibi intervals and wristAngle epochs; a single number otherwise. */
  value: number | number[];
  unit: string;
  /** ISO 8601 time the reading was taken. */
  takenAt: string;
  source: ReadingSource;
}

export interface StatusMessage {
  what: string;
  why: string;
  do: string;
}

/**
 * Which layer of the rules engine a rule belongs to (SPEC §6.2, §6.4): standard human ranges and
 * NASA limits, the astronaut's personal baseline, or a combination of several metrics.
 */
export type RuleLayer = "standard" | "baseline" | "combination";

/** Where a rule's limit comes from; the UI cites it on the learn card (SPEC §6.5). */
export interface RuleSource {
  /** NASA requirement ID such as "[V2 6004]", or null when the limit is not a NASA requirement. */
  requirementId: string | null;
  /** The document (and section) the limit comes from. */
  document: string;
  /** True when the status band is our own design choice rather than NASA's ("(ours)" in SPEC §6.5). */
  ours: boolean;
  /** Pages in docs/nasa backing the rule's messages, from the 2026-11-14 message audit; may be empty. */
  citations: string[];
}

/** One rule that fired: a watch or alert with its three-part message (SPEC §6.1, §6.3). */
export interface Evaluation {
  astronautId: string;
  ruleId: string;
  /** Short plain-language name, e.g. "Radiation dose spike". */
  title: string;
  area: Area;
  /** The spaceflight hazard the rule relates to, or null when it maps to none. */
  hazard: Hazard | null;
  /** The metrics the rule read. */
  metrics: Metric[];
  layer: RuleLayer;
  status: Status;
  message: StatusMessage;
  source: RuleSource;
  /** True when the rule reads only the ship's sensors, so it applies to the whole crew (SPEC §6.4). */
  crewWide: boolean;
  /** ISO time of the newest data the rule read. */
  at: string;
}

/** An area's status; null when no rule could rate it yet (no data, or no rule for the area). */
export interface AreaStatus {
  area: Area;
  status: Status | null;
  /** Why the area has no status, in plain language; null when it is rated. */
  reason: string | null;
}

/** A metric's status: the worse of its standard-range and personal-baseline rules (SPEC §6.2). */
export interface MetricStatus {
  metric: Metric;
  status: Status;
}

/** A rule that is defined but cannot run until the open settings or data it names exist. */
export interface PendingRule {
  ruleId: string;
  area: Area;
  /** Setting keys still unset, and astronaut profile fields still unknown ("profile.sex"). */
  waitingFor: string[];
}

/** The newest HRV value derived on the server from beat-to-beat intervals (SPEC §5.7). */
export interface DerivedHrv {
  rmssdMs: number;
  /** ISO start of its 5-minute window. */
  at: string;
}

/** Exercise minutes in the current UTC day (SPEC §5.4). */
export interface ExerciseMinutes {
  /** The UTC day counted, "YYYY-MM-DD". */
  day: string;
  /** Minutes at or above the threshold; null when the astronaut's age is unknown or there is no heart-rate reading today. */
  minutes: number | null;
  /** The daily goal; null while the setting is unset. */
  goalMinutes: number | null;
  /** 64% of the estimated max heart rate (220 − age); null when the age is unknown. */
  thresholdBpm: number | null;
}

/** The last 24 hours' radiation dose against the previous 7-day average (SPEC §5.7, §6.5). */
export interface RadiationDailyDose {
  dailyDoseUGy: number;
  previousSevenDayAverageUGy: number;
  /** dailyDoseUGy / previousSevenDayAverageUGy. */
  multiple: number;
  /** dailyDoseUGy as dose equivalent (estimate), mSv; null while the conversion setting is unset. */
  dailyDoseMSv: number | null;
  /** previousSevenDayAverageUGy as dose equivalent (estimate), mSv per day; null while the conversion setting is unset. */
  previousSevenDayAverageMSv: number | null;
  /** ISO time of the newest dose reading used. */
  at: string;
}

/** The menu nutrients the app totals (SPEC §5.5). */
export const NUTRIENTS =["kcal", "proteinG", "calciumMg", "vitaminDUg", "sodiumMg"] as const;

/** A nutrient, named like its field on Food (unit in the name). */
export type Nutrient = (typeof NUTRIENTS)[number];

/** A day's total of one nutrient from the meals logged. */
export interface NutrientTotal {
  /** Sum of the known values: the true total is at least this. */
  atLeast: number;
  /** Logged meals whose food has no value for this nutrient (not counted as 0). */
  unknownMeals: number;
}

/** One UTC day's logged meals, totaled. */
export interface NutritionDay {
  /** "YYYY-MM-DD", UTC (spacecraft local time). */
  day: string;
  /** False while the day is still running: its totals are shown but not rated. */
  complete: boolean;
  mealsLogged: number;
  totals: Record<Nutrient, NutrientTotal>;
}

/** A green band; null where NASA gives no bound or the astronaut profile is incomplete. */
export interface NutrientRange {
  min: number | null;
  max: number | null;
}

/** Daily targets: the green bands of NASA's nutrition requirements (SPEC §5.5, §6.7). */
export interface NutritionTargets {
  /** 90–110% of the estimated energy requirement (EER). */
  kcal: NutrientRange;
  /** At least 0.8 g per kg of body mass. */
  proteinG: NutrientRange;
  /** Share of calories from protein. */
  proteinPctOfKcal: NutrientRange;
  calciumMg: NutrientRange;
  vitaminDUg: NutrientRange;
  sodiumMg: NutrientRange;
  /** The EER itself, kcal/day; null until age, sex, mass and height are known. */
  eerKcal: number | null;
}

/** The five nutrition checks, each rated from one daily total (SPEC §6.7). */
export const NUTRITION_CHECKS = ["energy", "protein", "calcium", "vitaminD", "sodium"] as const;
export type NutritionCheck = (typeof NUTRITION_CHECKS)[number];

/** A UTC day's nutrition with its targets; `statuses` are null where the check is not rated. */
export interface NutritionDayStatus extends NutritionDay {
  targets: NutritionTargets;
  /**
   * Today: all null (running totals are not rated). Yesterday: each check's status, or null when
   * no meals were logged, a value is unknown, or the profile is incomplete.
   */
  statuses: Record<NutritionCheck, Status | null>;
}

/**
 * Radiation dose so far and projected (SPEC §6.7), as dose equivalent (an estimate) in mSv, against
 * NASA's career effective-dose limit as the closest stand-in.
 */
export interface MissionDose {
  /** Dose equivalent (estimate): prior career dose plus this mission's dose since its start. */
  mSv: number;
  careerLimitMSv: number;
  /** mSv ÷ careerLimitMSv, 0–1. */
  shareOfCareerLimit: number;
  /** Prior career dose plus the projected dose of the whole planned mission. */
  projectedMSv: number;
  /** projectedMSv ÷ careerLimitMSv. */
  projectedShareOfCareerLimit: number;
  /** The planned mission length the projection covers. */
  projectionDays: number;
  /** ISO time of the newest dose reading used. */
  at: string;
}

/** Values the server derives so clients show them without computing anything. */
export interface DerivedValues {
  hrv: DerivedHrv | null;
  exerciseToday: ExerciseMinutes;
  /** Null unless the ship has recent radiation readings covering each of the last 8 days. */
  radiationDailyDose: RadiationDailyDose | null;
  /** Null unless the career-dose settings are set and the ship has radiation readings. */
  missionDose: MissionDose | null;
  /** Today so far, unrated. */
  nutritionToday: NutritionDayStatus;
  /** Yesterday, the completed UTC day the Nutrition area is rated on. */
  nutritionYesterday: NutritionDayStatus;
}

/** GET /api/astronauts/:id/alerts?area=&from=&to=: one change of an area's or a rule's status, as the server saw it. */
export interface AlertLogEntry {
  id: string;
  /** ISO time of the evaluation that saw the change. */
  at: string;
  area: Area;
  /** The metric a rule rates when it reads exactly one; null for area changes and multi-metric rules. */
  metric: Metric | null;
  /** The rule that started or stopped firing; null for a change of the area's own status. */
  ruleId: string | null;
  title: string;
  /** A rule that is not firing is "normal"; an area with no status is null. */
  from: Status | null;
  to: Status | null;
  /** The rule's three-part message when it starts firing; null for area changes and clearings. */
  message: StatusMessage | null;
}

/** One line to draw on a metric's chart, in the chart's unit. */
export interface ReferenceLine {
  value: number;
  status: Exclude<Status, "normal">;
  label: string;
}

/** Where a chart's normal band and lines come from. */
export type ReferenceBasis = "settings" | "baseline" | "previousSevenDays";

/** What to draw on a metric's chart, so clients compute none. */
export interface ChartReference {
  /** The normal band to shade; a null bound is open. Null when there is none yet. */
  band: { low: number | null; high: number | null } | null;
  thresholds: ReferenceLine[];
  basis: ReferenceBasis;
}

/** GET /api/astronauts/:id/reference-lines: every chart's reference, in the chart's unit. */
export interface MetricReferenceLines extends ChartReference {
  metric: Metric;
  unit: string;
}

/** GET /api/astronauts/:id/status response: the one rules engine's verdict for every client. */
export interface AstronautStatus {
  astronautId: string;
  /** ISO time the status was evaluated. */
  at: string;
  /** The worst area status; null when no area could be rated. */
  overall: Status | null;
  /** One entry per area, in AREAS order. */
  areas: AreaStatus[];
  /** Every metric at least one standard or baseline rule could rate. */
  metrics: MetricStatus[];
  /** The rules that fired (watch or alert), alerts first. */
  evaluations: Evaluation[];
  /** Rules defined but not yet running, and the unset settings each waits for. */
  pendingRules: PendingRule[];
  /** Metrics whose newest reading has expired ("no recent data"); they get no status. */
  noRecentData: Metric[];
  derived: DerivedValues;
}

// The relay's types (SPEC §8, §9.2, §10) live in relay.ts.
export * from "./relay";
// Points, streak and badges (SPEC §7) live in gamification.ts.
export * from "./gamification";

/** POST /api/readings body. */
export interface ReadingsBatch {
  readings: Reading[];
  /** The uploading watch, which registers itself with its first upload (SPEC §9.2). */
  device?: DeviceReport;
}

/** What a watch says about itself with each upload. */
export interface DeviceReport {
  /** 1–64 characters. */
  watchId: string;
  /** 0–100, or null when unknown. */
  batteryPct: number | null;
}

/** POST /api/readings response. Duplicates (same astronaut, metric, time and source) are ignored. */
export interface ReadingsAccepted {
  accepted: number;
  duplicates: number;
}

/** Named chart windows for GET /api/astronauts/:id/series. "mission" is all stored data. */
export type SeriesRange = "1h" | "24h" | "7d" | "mission";

/** The spacecraft's own sensors (radiation, cabin) are stored under this id. */
export const SHIP_ID = "ship";

/** The metrics the spacecraft's own sensors record, stored under SHIP_ID and shared by the whole crew. */
export const SHIP_METRICS = ["radiationDoseRate", "co2", "cabinTemp", "humidity"] as const satisfies readonly Metric[];
export type ShipMetric = (typeof SHIP_METRICS)[number];

/** GET /api/settings: every number the rules use, so clients show them instead of typing them. */
export interface RuleSettingsResponse {
  /** Setting key → value (null while undecided), e.g. "spo2.watchBelowPct": 95. Always holds DISPLAY_SETTING_KEYS. */
  settings: Record<string, number | null> & Record<DisplaySettingKey, number | null>;
  /** Minutes after which a metric's newest reading expires. */
  maxReadingAgeMinutes: Partial<Record<Metric, number>>;
  /** Every limit the rules use, in plain language, grouped by area in AREAS order. */
  limits: AreaLimit[];
}

/**
 * The setting keys clients show by name (GET /api/settings), defined once. The server's settings
 * must include every one of them.
 */
export const DISPLAY_SETTING_KEYS = ["radiation.doseEquivalentPerAbsorbedDose", "exercise.dailyGoalMinutes", "exercise.moderateIntensityFraction"] as const;
export type DisplaySettingKey = (typeof DISPLAY_SETTING_KEYS)[number];

/**
 * One limit the rules use, for the dashboard's "Limits in use" list (GET /api/settings). The label
 * never repeats the number: clients show `label`, then `value` and `unit`, e.g. "Blood oxygen,
 * watch below" 95 "%".
 */
export interface AreaLimit {
  area: Area;
  label: string;
  /** Omitted for a limit with no single number (the temperature + humidity zone). */
  value?: number;
  /** Omitted with `value`, and for a plain count. */
  unit?: string;
  /** The status past the limit; "normal" for a goal; null for a parameter such as a window length. */
  status: Status | null;
  /** The source of the rule the limit belongs to. */
  source: RuleSource;
}

/** Named windows for GET /api/astronauts/:id/exercise/daily: the last 7 UTC days, or every day since mission day 1. */
export const EXERCISE_DAY_RANGES = ["7d", "mission"] as const;
export type ExerciseDayRange = (typeof EXERCISE_DAY_RANGES)[number];

/** GET /api/astronauts/:id/exercise/daily: one UTC day's exercise minutes, counted like today's (SPEC §5.4). */
export interface ExerciseDay {
  /** "YYYY-MM-DD", UTC. */
  day: string;
  /** Null when the astronaut's age is unknown or there is no heart-rate reading that day; today counts up to now. */
  minutes: number | null;
  /** The daily goal; null while the setting is unset. */
  goalMinutes: number | null;
}

export interface Astronaut {
  id: string;
  name: string;
  watchId: string | null;
  /** Whole years, or null when unknown. Used for estimated max heart rate (220 − age) and energy needs. */
  age: number | null;
  /** For the estimated energy requirement (EER); null when unknown. */
  sex: Sex | null;
  /** Body mass in kilograms; null when unknown. */
  massKg: number | null;
  /** Height in meters; null when unknown. */
  heightM: number | null;
}

export type Sex = "male" | "female";

export interface SeriesPoint {
  /** ISO time of the bucket start (or the reading time when not bucketed). */
  t: string;
  value: number;
  /** Number of readings averaged into this point. */
  n: number;
  source: ReadingSource;
}

export interface SeriesResponse {
  astronautId: string;
  metric: Metric;
  unit: string;
  bucketMinutes: number | null;
  points: SeriesPoint[];
  /** The chart's normal band and alert lines; null when the metric has none. */
  reference: ChartReference | null;
}

export interface LatestReading {
  metric: Metric;
  value: number | number[];
  unit: string;
  takenAt: string;
  source: ReadingSource;
}

export interface MealLog {
  id: number;
  astronautId: string;
  foodId: string;
  eatenAt: string;
}

/** The whole-number scale of check-in mood and stress (SPEC §5.6), defined once for every client. */
export const CHECK_IN_SCALE = { min: 1, max: 5 } as const;

export interface CheckIn {
  id: number;
  astronautId: string;
  /** 1 (very low) to 5 (very good). */
  mood: number;
  /** 1 (calm) to 5 (very stressed). */
  stress: number;
  at: string;
}

/** What each end of the check-in scale means. */
export const CHECK_IN_LABELS = {
  mood: { min: "very low", max: "very good" },
  stress: { min: "calm", max: "very stressed" },
} as const;

export interface Food {
  id: string;
  name: string;
  category: string;
  foodType: string | null;
  serving: string;
  kcal: number | null;
  proteinG: number | null;
  calciumMg: number | null;
  vitaminDUg: number | null;
  sodiumMg: number | null;
  sourceByField?: Record<string, string>;
  note?: string;
}

export interface FoodSource {
  id: string;
  title: string;
  url: string;
}

/** GET /api/menu response. */
export interface FoodMenu {
  sources: FoodSource[];
  notes?: string;
  foods: Food[];
}

export type ScheduledTaskKind = "ecg" | "spo2" | "checkIn" | "meal" | "exercise";

/** One daily task in GET /api/astronauts/:id/schedule; drives reminders and "Today's tasks". */
export interface ScheduledTask {
  id: string;
  kind: ScheduledTaskKind;
  label: string;
  /** "HH:MM", 24-hour, spacecraft local time (UTC); null for a task with no set time (exercise). */
  localTime: string | null;
  /** The astronaut it applies to, or null for every astronaut. */
  astronautId: string | null;
}

/** Progress toward a daily goal (the exercise task). */
export interface TaskProgress {
  value: number;
  goal: number;
  unit: string;
}

/** GET /api/astronauts/:id/tasks/today: one task of today's schedule with its done-state from real activity. */
export interface TaskState {
  taskId: string;
  kind: ScheduledTaskKind;
  label: string;
  /** "HH:MM" UTC, or null for a task with no set time (the exercise goal). */
  localTime: string | null;
  /** Done when real activity of the task's kind was recorded near its time (or the goal is met). */
  done: boolean;
  /** ISO time of the activity that completed it; null when not done or when done by a daily goal. */
  doneAt: string | null;
  /** For the exercise task: minutes so far against the goal; null otherwise. */
  progress: TaskProgress | null;
  /** Points the task earns once done (SPEC §7); null while its points setting is unset. */
  points: number | null;
}

/** Gravity settings a mission can run in (SPEC §5.4). */
export type GravitySetting = "iss" | "moon" | "mars" | "earth";

/** The mission settings record. */
export interface Mission {
  name: string;
  /** "YYYY-MM-DD", UTC: mission day 1. */
  startDate: string;
  gravity: GravitySetting;
  /**
   * The IANA time zone whose noon-to-noon days live sleep is detected over (SPEC §5.7): "UTC" in
   * flight, a home zone for testing on Earth. Every time shown stays in UTC.
   */
  sleepDayTimeZone: string;
}

/** GET /api/mission. */
export interface MissionResponse {
  name: string;
  /** "YYYY-MM-DD", UTC: mission day 1. */
  startDate: string;
  /** Days since the start, counting the start date as day 1 (UTC), counted by the server. */
  missionDay: number;
  gravity: { preset: GravitySetting; label: string };
  /** The IANA time zone of the sleep day (noon to noon), e.g. "UTC" (SPEC §5.7). */
  sleepDayTimeZone: string;
}

/** PUT /api/mission/sleep-day-time-zone body. */
export interface SleepDayTimeZoneChange {
  /** An IANA time zone name, e.g. "UTC" or "America/Indiana/Indianapolis". */
  timeZone: string;
}

/** GET /api/health response. */
export interface HealthResponse {
  ok: true;
  service: "onboard";
  time: string;
}

// The demo's simulated solar storm steps and state (SPEC §5.7, §13) live in demo.ts.
export * from "./demo";
