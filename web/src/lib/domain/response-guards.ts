// One guard per onboard-server response the app reads (SPEC §10), checked against the real types
// in @heartbeat/shared, so every response is verified where it enters.

import {
  AREAS, BADGE_IDS, DELAY_PRESETS, DISPLAY_SETTING_KEYS, RELAY_DIRECTIONS, METRICS, NUTRIENTS, NUTRITION_CHECKS, READING_SOURCE_LABELS,
  type AreaLimit, type ExerciseDay,
  type AlertLogEntry, type AreaStatus, type Astronaut, type AstronautStatus, type ChartReference, type CheckIn,
  type DerivedValues, type Evaluation, type Food, type FoodMenu, type FoodSource, type GravitySetting, type Hazard,
  type LatestReading, type MealLog, type MissionDose, type MissionResponse, type Nutrient,
  type NutrientRange, type NutrientTotal, type NutritionCheck, type NutritionDayStatus, type NutritionTargets,
  type ReadingSource, type ReferenceBasis, type RuleLayer, type RuleSettingsResponse, type ScheduledTask, type ScheduledTaskKind,
  type SeriesPoint, type SeriesResponse, type Sex, type Status, type StatusMessage, type TaskState,
  type AlertHandling, type CrewChange, type DelayPresetInfo, type FailedCrewChange, type FiringStatus, type GroundAlert,
  type GroundAlertState, type GroundCrewMember, type GroundCrewResponse, type GroundMissionResponse, type GroundNote,
  type SolarStormCleared, type SolarStormStarted, type SolarStormState,
  type GroundSeriesResponse, type LiveMessage, type NewAstronaut, type OnboardAlert, type OnboardNote, type PendingCrewChange,
  type RelayDelayResponse, type RelayEvent, type RelayEventKind, type StatusSnapshot, type WatchInfo,
  type DailyCalories, type DailyLog, type GroundDailyLogResponse, type Badge, type PointsSummary,
} from "@heartbeat/shared";
import { BASIS_TEXT } from "./chart";
import {
  arrayOf, isBoolean, isNumber, isRecord, isString, keysOf, nullable, oneOf, optional, recordOf, shape, type Guard,
} from "./guards";
import { STATUS_LOOK } from "./status";

// Each list is built from a record keyed by its shared union, so it is complete by construction.
const HAZARDS = keysOf<Hazard>({ radiation: true, isolation: true, distance: true, gravity: true, environment: true });
const STATUSES = keysOf<Status>(STATUS_LOOK);
const FIRING_STATUSES = keysOf<FiringStatus>({ watch: true, alert: true });
const SOURCES = keysOf<ReadingSource>(READING_SOURCE_LABELS);
const TASK_KINDS = keysOf<ScheduledTaskKind>({ ecg: true, spo2: true, checkIn: true, meal: true, exercise: true });
const SEXES = keysOf<Sex>({ male: true, female: true });
const GRAVITY_SETTINGS = keysOf<GravitySetting>({ iss: true, moon: true, mars: true, earth: true });
const REFERENCE_BASES = keysOf<ReferenceBasis>(BASIS_TEXT);
const RULE_LAYERS = keysOf<RuleLayer>({ standard: true, baseline: true, combination: true });

const isArea = oneOf(AREAS);
const isMetric = oneOf(METRICS);
const isStatus = oneOf(STATUSES);
const isNumberOrArray = (value: unknown): value is number | number[] => isNumber(value) || arrayOf(isNumber)(value);

/** A record with exactly the given keys, each passing the guard. */
function keyedBy<K extends string, T>(keys: readonly K[], guard: Guard<T>): Guard<Record<K, T>> {
  return (value): value is Record<K, T> => isRecord(value) && keys.every((key) => guard(value[key]));
}

export const isAstronaut = shape<Astronaut>({
  id: isString,
  name: isString,
  watchId: nullable(isString),
  age: nullable(isNumber),
  sex: nullable(oneOf(SEXES)),
  massKg: nullable(isNumber),
  heightM: nullable(isNumber),
});
export const isCrew = arrayOf(isAstronaut);

export const isLatestReadings = arrayOf(
  shape<LatestReading>({ metric: isMetric, value: isNumberOrArray, unit: isString, takenAt: isString, source: oneOf(SOURCES) }),
);

const chartReferenceFields = {
  band: nullable(shape({ low: nullable(isNumber), high: nullable(isNumber) })),
  thresholds: arrayOf(shape({ value: isNumber, status: oneOf(FIRING_STATUSES), label: isString })),
  basis: oneOf(REFERENCE_BASES),
};

export const isChartReference = shape<ChartReference>(chartReferenceFields);

const seriesFields = {
  astronautId: isString,
  metric: isMetric,
  unit: isString,
  bucketMinutes: nullable(isNumber),
  points: arrayOf(shape<SeriesPoint>({ t: isString, value: isNumber, n: isNumber, source: oneOf(SOURCES) })),
  reference: nullable(isChartReference),
};

export const isSeries = shape<SeriesResponse>(seriesFields);

export const isSchedule = arrayOf(
  shape<ScheduledTask>({ id: isString, kind: oneOf(TASK_KINDS), label: isString, localTime: nullable(isString), astronautId: nullable(isString) }),
);

export const isTaskStates = arrayOf(
  shape<TaskState>({
    taskId: isString,
    kind: oneOf(TASK_KINDS),
    label: isString,
    localTime: nullable(isString),
    done: isBoolean,
    doneAt: nullable(isString),
    progress: nullable(shape({ value: isNumber, goal: isNumber, unit: isString })),
    points: nullable(isNumber),
  }),
);

export const isPointsSummary = shape<PointsSummary>({
  astronautId: isString,
  at: isString,
  day: isString,
  totalPoints: isNumber,
  today: shape({ points: isNumber, possiblePoints: isNumber, tasksDone: isNumber, tasks: isNumber }),
  streak: shape({ days: isNumber, includesToday: isBoolean }),
  badges: arrayOf(shape<Badge>({ id: oneOf(BADGE_IDS), name: isString, description: isString, earnedOn: nullable(isString) })),
});

const isFood = shape<Food>({
  id: isString,
  name: isString,
  category: isString,
  foodType: nullable(isString),
  serving: isString,
  kcal: nullable(isNumber),
  proteinG: nullable(isNumber),
  calciumMg: nullable(isNumber),
  vitaminDUg: nullable(isNumber),
  sodiumMg: nullable(isNumber),
  sourceByField: optional(recordOf(isString)),
  note: optional(isString),
});

export const isMenu = shape<FoodMenu>({
  sources: arrayOf(shape<FoodSource>({ id: isString, title: isString, url: isString })),
  notes: optional(isString),
  foods: arrayOf(isFood),
});

export const isMealLog = shape<MealLog>({ id: isNumber, astronautId: isString, foodId: isString, eatenAt: isString });
export const isMealLogs = arrayOf(isMealLog);

export const isCheckIn = shape<CheckIn>({ id: isNumber, astronautId: isString, mood: isNumber, stress: isNumber, at: isString });
export const isCheckIns = arrayOf(isCheckIn);

export const isDeleted = shape<{ deleted: true }>({ deleted: (value): value is true => value === true });

const isMessage = shape<StatusMessage>({ what: isString, why: isString, do: isString });

const isRuleSource = shape({ requirementId: nullable(isString), document: isString, ours: isBoolean, citations: arrayOf(isString) });

const isEvaluation = shape<Evaluation>({
  astronautId: isString,
  ruleId: isString,
  title: isString,
  area: isArea,
  hazard: nullable(oneOf(HAZARDS)),
  metrics: arrayOf(isMetric),
  layer: oneOf(RULE_LAYERS),
  status: isStatus,
  message: isMessage,
  source: isRuleSource,
  crewWide: isBoolean,
  at: isString,
});

const isRange = shape<NutrientRange>({ min: nullable(isNumber), max: nullable(isNumber) });

const isNutritionDay = shape<NutritionDayStatus>({
  day: isString,
  complete: isBoolean,
  mealsLogged: isNumber,
  totals: keyedBy<Nutrient, NutrientTotal>(NUTRIENTS, shape<NutrientTotal>({ atLeast: isNumber, unknownMeals: isNumber })),
  targets: shape<NutritionTargets>({
    kcal: isRange,
    proteinG: isRange,
    proteinPctOfKcal: isRange,
    calciumMg: isRange,
    vitaminDUg: isRange,
    sodiumMg: isRange,
    eerKcal: nullable(isNumber),
  }),
  statuses: keyedBy<NutritionCheck, Status | null>(NUTRITION_CHECKS, nullable(isStatus)),
});

const isMissionDose = shape<MissionDose>({
  mSv: isNumber,
  careerLimitMSv: isNumber,
  shareOfCareerLimit: isNumber,
  projectedMSv: isNumber,
  projectedShareOfCareerLimit: isNumber,
  projectionDays: isNumber,
  at: isString,
});

const isDerived = shape<DerivedValues>({
  hrv: nullable(shape({ rmssdMs: isNumber, at: isString })),
  exerciseToday: shape({ day: isString, minutes: nullable(isNumber), goalMinutes: nullable(isNumber), thresholdBpm: nullable(isNumber) }),
  radiationDailyDose: nullable(
    shape({
      dailyDoseUGy: isNumber,
      previousSevenDayAverageUGy: isNumber,
      multiple: isNumber,
      dailyDoseMSv: nullable(isNumber),
      previousSevenDayAverageMSv: nullable(isNumber),
      at: isString,
    }),
  ),
  missionDose: nullable(isMissionDose),
  nutritionToday: isNutritionDay,
  nutritionYesterday: isNutritionDay,
});

const isAreaStatus = shape<AreaStatus>({ area: isArea, status: nullable(isStatus), reason: nullable(isString) });

export const isAstronautStatus = shape<AstronautStatus>({
  astronautId: isString,
  at: isString,
  overall: nullable(isStatus),
  areas: arrayOf(isAreaStatus),
  metrics: arrayOf(shape({ metric: isMetric, status: isStatus })),
  evaluations: arrayOf(isEvaluation),
  pendingRules: arrayOf(shape({ ruleId: isString, area: isArea, waitingFor: arrayOf(isString) })),
  noRecentData: arrayOf(isMetric),
  derived: isDerived,
});

export const isMission = shape<MissionResponse>({
  name: isString,
  startDate: isString,
  missionDay: isNumber,
  gravity: shape({ preset: oneOf(GRAVITY_SETTINGS), label: isString }),
  sleepDayTimeZone: isString,
});

export const isAlertLog = arrayOf(
  shape<AlertLogEntry>({
    id: isString,
    at: isString,
    area: isArea,
    metric: nullable(isMetric),
    ruleId: nullable(isString),
    title: isString,
    from: nullable(isStatus),
    to: nullable(isStatus),
    message: nullable(isMessage),
  }),
);

const isAreaLimit = shape<AreaLimit>({
  area: isArea,
  label: isString,
  value: optional(isNumber),
  unit: optional(isString),
  status: nullable(isStatus),
  source: isRuleSource,
});

/** The settings, which must hold every DISPLAY_SETTING_KEYS key, plus the plain-language limits. */
const isSettingValues = (value: unknown): value is RuleSettingsResponse["settings"] =>
  recordOf(nullable(isNumber))(value) && DISPLAY_SETTING_KEYS.every((key) => key in value);

export const isSettings = shape<RuleSettingsResponse>({
  settings: isSettingValues,
  maxReadingAgeMinutes: recordOf(isNumber),
  limits: arrayOf(isAreaLimit),
});

export const isExerciseDays = arrayOf(shape<ExerciseDay>({ day: isString, minutes: nullable(isNumber), goalMinutes: nullable(isNumber) }));

// ---- The relay (SPEC §8, §10; shared/src/relay.ts) ----

const ALERT_STATES = keysOf<GroundAlertState>({ new: true, acknowledged: true, resolved: true });
const HANDLED_STATES = keysOf<AlertHandling["state"]>({ acknowledged: true, resolved: true });
const RELAY_KINDS = keysOf<RelayEventKind>(RELAY_DIRECTIONS);

export const isRelayDelay = shape<RelayDelayResponse>({
  preset: oneOf(DELAY_PRESETS),
  realTime: isBoolean,
  label: isString,
  oneWayDelayMs: isNumber,
  presets: arrayOf(shape<DelayPresetInfo>({ preset: oneOf(DELAY_PRESETS), label: isString, realDelayMs: isNumber, demoDelayMs: isNumber })),
});

/** The answer to every write through the relay (202): the event sent. Its payload is not read. */
export const isRelayEvent = shape<Pick<RelayEvent, "id" | "kind" | "sentAt" | "deliverAt">>({
  id: isString,
  kind: oneOf(RELAY_KINDS),
  sentAt: isString,
  deliverAt: isString,
});

const isWatchInfo = shape<WatchInfo>({ watchId: isString, lastContactAt: nullable(isString), batteryPct: nullable(isNumber) });

const isStatusSnapshot = shape<StatusSnapshot>({
  astronautId: isString,
  at: isString,
  overall: nullable(isStatus),
  areas: arrayOf(isAreaStatus),
});

const isNewAstronaut = shape<NewAstronaut>({
  id: isString,
  name: isString,
  age: nullable(isNumber),
  sex: nullable(oneOf(SEXES)),
  massKg: nullable(isNumber),
  heightM: nullable(isNumber),
});

function isCrewChange(value: unknown): value is CrewChange {
  if (!isRecord(value)) return false;
  switch (value.action) {
    case "addAstronaut":
      return isNewAstronaut(value.astronaut);
    case "removeAstronaut":
    case "unassignWatch":
      return isString(value.astronautId);
    case "assignWatch":
      return isString(value.astronautId) && isString(value.watchId);
    default:
      return false;
  }
}

export const isGroundCrew = shape<GroundCrewResponse>({
  relay: isRelayDelay,
  dataAsOf: nullable(isString),
  crew: arrayOf(
    shape<GroundCrewMember>({
      astronautId: isString,
      name: isString,
      watch: nullable(isWatchInfo),
      status: nullable(isStatusSnapshot),
      receivedAt: nullable(isString),
    }),
  ),
  unassignedWatches: arrayOf(isWatchInfo),
  pendingChanges: arrayOf(shape<PendingCrewChange>({ changeId: isString, change: isCrewChange, sentAt: isString, arrivesOnboardAt: isString })),
  failedChanges: arrayOf(shape<FailedCrewChange>({ changeId: isString, change: isCrewChange, reason: isString, receivedAt: isString })),
});

export const isGroundMission = shape<GroundMissionResponse>({
  mission: nullable(isMission),
  sentAt: nullable(isString),
  receivedAt: nullable(isString),
});

const isDailyLog = shape<DailyLog>({
  astronautId: isString,
  at: isString,
  checkIns: arrayOf(isCheckIn),
  calories: arrayOf(shape<DailyCalories>({ day: isString, kcalAtLeast: isNumber, mealsLogged: isNumber, mealsWithoutKcal: isNumber })),
  exercise: isExerciseDays,
});

export const isGroundDailyLog = shape<GroundDailyLogResponse>({ log: nullable(isDailyLog), sentAt: nullable(isString), receivedAt: nullable(isString) });

export const isGroundSeries = shape<GroundSeriesResponse>({ ...seriesFields, dataAsOf: isString, oneWayDelayMs: isNumber });

const relayedAlertFields = {
  alertLogId: isString,
  astronautId: isString,
  ruleId: isString,
  title: isString,
  area: isArea,
  metric: nullable(isMetric),
  status: oneOf(FIRING_STATUSES),
  crewWide: isBoolean,
  message: nullable(isMessage),
  at: isString,
};

export const isGroundAlerts = arrayOf(
  shape<GroundAlert>({
    ...relayedAlertFields,
    alertId: isString,
    sentAt: isString,
    receivedAt: isString,
    lagMs: isNumber,
    state: oneOf(ALERT_STATES),
    stateChangedAt: nullable(isString),
  }),
);

export const isGroundNotes = arrayOf(
  shape<GroundNote>({
    astronautId: isString,
    text: isString,
    alertId: nullable(isString),
    noteId: isString,
    sentAt: isString,
    deliverAt: isString,
    readAt: nullable(isString),
    readReceiptReceivedAt: nullable(isString),
  }),
);

export const isOnboardNotes = arrayOf(
  shape<OnboardNote>({ noteId: isString, text: isString, alertId: nullable(isString), sentAt: isString, receivedAt: isString, readAt: nullable(isString) }),
);

export const isOnboardAlerts = arrayOf(
  shape<OnboardAlert>({
    ...relayedAlertFields,
    alertId: isString,
    sentAt: isString,
    deliverAt: isString,
    handling: nullable(shape<AlertHandling>({ state: oneOf(HANDLED_STATES), at: isString, receivedAt: isString })),
  }),
);

const isEventHeader = shape<Pick<RelayEvent, "id" | "kind">>({ id: isString, kind: oneOf(RELAY_KINDS) });

/**
 * A message on /ws/onboard or /ws/ground. Only the fields the app acts on are checked (the message
 * type and, for relay events, the event kind); the page then reloads its data from the server.
 */
export function isLiveMessage(value: unknown): value is LiveMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "relaySent":
    case "relayDelivered":
      return isEventHeader(value.event);
    case "relayDelay":
      return isRecord(value.relay);
    case "points":
      return isRecord(value.points) && isString(value.points.astronautId);
    case "readings":
      // The dashboard reloads for its astronaut's ECG and SpO₂ (shouldRefresh), so both are checked.
      return isString(value.astronautId) && arrayOf(isMetric)(value.metrics);
    case "status":
      return true;
    default:
      return false;
  }
}

// ---- The demo's labeled simulated solar storm (SPEC §13): the surgeon console's demo control ----

export const isSolarStormState = shape<SolarStormState>({ active: isBoolean, factor: nullable(isNumber), startedAt: nullable(isString) });

const isTrue = (value: unknown): value is true => value === true;

export const isStormStarted = shape<SolarStormStarted>({ simulated: isTrue, factor: isNumber, hours: isNumber, baselineUGyPerHour: isNumber });

export const isStormCleared = shape<SolarStormCleared>({ cleared: isTrue, clearedAt: isString });
