// Test-only fixtures in the shapes of @heartbeat/shared. Imported only by *.test.ts files; never rendered.

import type { Area, AstronautStatus, Evaluation, MissionResponse, Nutrient, NutritionDayStatus, Status, TaskState } from "@heartbeat/shared";

export function evaluationFixture(ruleId: string, status: Status, at: string, area: Area = "radiation"): Evaluation {
  return {
    astronautId: "a1",
    ruleId,
    title: `${ruleId} title`,
    area,
    hazard: null,
    metrics: [],
    layer: "standard",
    status,
    message: { what: `${ruleId} what`, why: "why", do: "do" },
    source: { requirementId: null, document: "test", ours: true, citations: [] },
    crewWide: false,
    at,
  };
}

const range = (min: number | null, max: number | null) => ({ min, max });

export function nutritionDayFixture(totals: Partial<Record<Nutrient, number>> = {}, complete = false): NutritionDayStatus {
  const total = (key: Nutrient) => ({ atLeast: totals[key] ?? 0, unknownMeals: 0 });
  return {
    day: "2026-11-14",
    complete,
    mealsLogged: Object.keys(totals).length > 0 ? 1 : 0,
    totals: { kcal: total("kcal"), proteinG: total("proteinG"), calciumMg: total("calciumMg"), vitaminDUg: total("vitaminDUg"), sodiumMg: total("sodiumMg") },
    targets: {
      kcal: range(2000, 2400),
      proteinG: range(56, null),
      proteinPctOfKcal: range(12, 15),
      calciumMg: range(1000, 2000),
      vitaminDUg: range(25, 100),
      sodiumMg: range(1500, 2300),
      eerKcal: 2200,
    },
    statuses: { energy: null, protein: null, calcium: null, vitaminD: null, sodium: null },
  };
}

export function statusFixture(areas: Partial<Record<Area, Status | null>> = {}, evaluations: Evaluation[] = []): AstronautStatus {
  return {
    astronautId: "a1",
    at: "2026-11-14T12:00:00Z",
    overall: null,
    areas: Object.entries(areas).map(([area, status]) => ({ area: area as Area, status: status ?? null, reason: null })),
    metrics: [],
    evaluations,
    pendingRules: [],
    noRecentData: [],
    derived: {
      hrv: null,
      exerciseToday: { day: "2026-11-14", minutes: null, goalMinutes: 120, thresholdBpm: null },
      radiationDailyDose: null,
      missionDose: null,
      nutritionToday: nutritionDayFixture(),
      nutritionYesterday: nutritionDayFixture({}, true),
    },
  };
}

export const MISSION_FIXTURE: MissionResponse = {
  name: "Heartbeat ISS Demo",
  startDate: "2026-11-05",
  missionDay: 10,
  gravity: { preset: "iss", label: "ISS (microgravity)" },
  sleepDayTimeZone: "UTC",
};

export function taskFixture(taskId: string, localTime: string | null, done = false, overrides: Partial<TaskState> = {}): TaskState {
  return { taskId, kind: "ecg", label: taskId, localTime, done, doneAt: null, progress: null, points: null, ...overrides };
}
