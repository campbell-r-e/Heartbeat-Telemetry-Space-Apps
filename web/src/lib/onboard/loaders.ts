import "server-only";

// Loads and shapes what each page needs from the onboard server. Pages call these; components
// never fetch.

import { cookies } from "next/headers";
import {
  AREAS, SHIP_ID, type Area, type DisplaySettingKey, type RuleSettingsResponse, type Astronaut, type AstronautStatus, type CheckIn, type MealLog, type MissionDose,
  type NutritionDayStatus, type SeriesRange, type SolarStormState,
  type GroundAlert, type GroundCrewResponse, type GroundMissionResponse, type GroundDailyLogResponse, type GroundNote, type GroundSeriesResponse,
  type OnboardAlert, type OnboardNote, type RelayDelayResponse, type PointsSummary, type TaskState,
} from "@heartbeat/shared";
import { CREW_COOKIE, chooseAstronaut } from "../crew-choice";
import { AREA_CHARTS, chartSourceKey, type ChartSource, type ChartSpec, type SecondaryPanel } from "../domain/area-charts";
import { fromSeriesPoints, type ChartData } from "../domain/chart";
import { CHECK_IN_HISTORY_DAYS, checkInChartData } from "../domain/checkin";
import { METRIC_DISPLAY, indexLatest, isShownMetric, metricOwner, unitText, type ShownMetric } from "../domain/metrics";
import { exerciseChartData, exerciseDayRange } from "../domain/exercise";
import { calorieChartData, indexFoods } from "../domain/nutrition";
import { loadOrProblem, type Loaded } from "../domain/onboard-response";
import { chartWindow, rangeWindow, seriesQuery, windowQuery, type TimeWindow } from "../domain/ranges";
import { ALERT_CHART_BUCKET_MINUTES, ALERT_FEED_DAYS, alertChartWindow, type AlertChart, type GroundChartSpec } from "../domain/surgeon";
import type { AreaSnapshot } from "../domain/readouts";
import { ALERT_HISTORY_DAYS, areaReason } from "../domain/status";
import { DAY_MS, endOfUtcDay, startOfUtcDay } from "../domain/time";
import * as api from "./api";

export interface CrewSelection {
  crew: Astronaut[];
  astronaut: Astronaut;
}

/** The crew and the member this browser shows (decision 13). */
export async function loadCrewSelection(): Promise<CrewSelection> {
  const [crew, cookieStore] = await Promise.all([api.listAstronauts(), cookies()]);
  const astronaut = chooseAstronaut(crew, cookieStore.get(CREW_COOKIE)?.value);
  if (!astronaut) throw new Error("The onboard server has no astronauts on the crew.");
  return { crew, astronaut };
}

export async function loadChart(source: ChartSource, astronautId: string, range: SeriesRange, nowMs: number): Promise<ChartData> {
  switch (source.kind) {
    case "metric": {
      const series = await api.getSeries(metricOwner(source.metric, astronautId), source.metric, range);
      const points = fromSeriesPoints(series.points);
      return {
        points,
        unit: unitText(series.unit),
        decimals: METRIC_DISPLAY[source.metric].decimals,
        reference: series.reference,
        goal: null,
        window: chartWindow(range, nowMs, points[0]?.tMs ?? null),
        timeUnit: "time",
      };
    }
    case "checkIns": {
      const checkIns = await api.getCheckIns(astronautId, rangeWindow(range, nowMs));
      return checkInChartData(checkIns, source.field, range, nowMs);
    }
    case "dailyCalories": {
      const [meals, menu] = await Promise.all([api.getMeals(astronautId, rangeWindow(range, nowMs)), api.getMenu()]);
      return calorieChartData(meals, indexFoods(menu.foods), range, nowMs);
    }
    case "exerciseDays": {
      const days = await api.getExerciseDays(astronautId, exerciseDayRange(range));
      return exerciseChartData(days, range, nowMs);
    }
  }
}

export function loadAlertLog(astronautId: string, area: Area, nowMs: number) {
  return api.getAlertLog(astronautId, area, { fromMs: nowMs - ALERT_HISTORY_DAYS * DAY_MS, toMs: endOfUtcDay(nowMs) });
}

// Logs end at the end of today (UTC), not at this request's "now": the onboard server stamps a new
// meal or check-in with its own clock, which can run a few milliseconds ahead of this process.

export function loadMealsToday(astronautId: string, nowMs: number): Promise<MealLog[]> {
  return api.getMeals(astronautId, { fromMs: startOfUtcDay(nowMs), toMs: endOfUtcDay(nowMs) });
}

export function loadRecentCheckIns(astronautId: string, nowMs: number): Promise<CheckIn[]> {
  return api.getCheckIns(astronautId, { fromMs: nowMs - CHECK_IN_HISTORY_DAYS * DAY_MS, toMs: endOfUtcDay(nowMs) });
}

/** The rules engine's status; a failure is shown inline on the page, not hidden (decision 16). */
export const loadStatus = (astronautId: string): Promise<Loaded<AstronautStatus>> => loadOrProblem(() => api.getStatus(astronautId));

/** Points, streak and badges (SPEC §7); a failure degrades only what shows them, not the page. */
export const loadPoints = (astronautId: string): Promise<Loaded<PointsSummary>> => loadOrProblem(() => api.getPoints(astronautId));

/** Today's tasks, for pages that can live without them (the meal picker's points label). */
export const loadTasksToday = (astronautId: string): Promise<Loaded<TaskState[]>> => loadOrProblem(() => api.getTasksToday(astronautId));

export interface AreaContext {
  snapshot: AreaSnapshot;
  status: Loaded<AstronautStatus>;
}

/** Everything the readouts of every area need, loaded in parallel. */
export async function loadAreaContext(astronautId: string, nowMs: number): Promise<AreaContext> {
  const [astronautLatest, shipLatest, checkIns, status, mission] = await Promise.all([
    api.getLatest(astronautId),
    api.getLatest(SHIP_ID),
    loadRecentCheckIns(astronautId, nowMs),
    loadStatus(astronautId),
    api.getMission(),
  ]);
  return {
    snapshot: { latest: indexLatest(astronautLatest, shipLatest), checkIns, derived: status.ok ? status.value.derived : null, mission, nowMs },
    status,
  };
}

/** The mini chart of every dashboard card, keyed by area. */
export async function loadCardCharts(astronautId: string, nowMs: number): Promise<Map<Area, ChartData>> {
  const entries = await Promise.all(
    AREAS.map(async (area) => {
      const { main, cardRange } = AREA_CHARTS[area];
      return [area, await loadChart(main.source, astronautId, cardRange, nowMs)] as const;
    }),
  );
  return new Map(entries);
}

/** The server setting that turns absorbed dose into the dose equivalent (estimate), one of DISPLAY_SETTING_KEYS. */
const DOSE_EQUIVALENT_SETTING: DisplaySettingKey = "radiation.doseEquivalentPerAbsorbedDose";

/** A detail-page panel together with its own data (no index matching). */
export type LoadedPanel =
  | { kind: "chart"; chart: ChartSpec; data: ChartData }
  | { kind: "radiationDose"; dose: MissionDose | null; statusProblem: string | null; doseEquivalentPerAbsorbedDose: number | null }
  | { kind: "nutrientTotals"; today: NutritionDayStatus | null; yesterday: NutritionDayStatus | null; yesterdayReason: string | null; statusProblem: string | null };

export async function loadPanels(
  panels: readonly SecondaryPanel[],
  context: { astronautId: string; range: SeriesRange; nowMs: number; status: Loaded<AstronautStatus>; settings: RuleSettingsResponse },
): Promise<LoadedPanel[]> {
  const { status, settings } = context;
  const derived = status.ok ? status.value.derived : null;
  const statusProblem = status.ok ? null : status.problem;
  return Promise.all(
    panels.map(async (panel): Promise<LoadedPanel> => {
      switch (panel.kind) {
        case "chart":
          return { kind: "chart", chart: panel.chart, data: await loadChart(panel.chart.source, context.astronautId, context.range, context.nowMs) };
        case "radiationDose":
          return {
            kind: "radiationDose",
            dose: derived?.missionDose ?? null,
            statusProblem,
            doseEquivalentPerAbsorbedDose: settings.settings[DOSE_EQUIVALENT_SETTING],
          };
        case "nutrientTotals":
          return {
            kind: "nutrientTotals",
            today: derived?.nutritionToday ?? null,
            yesterday: derived?.nutritionYesterday ?? null,
            yesterdayReason: areaReason(status.ok ? status.value : null, "nutrition"),
            statusProblem,
          };
      }
    }),
  );
}

// ---- The relay on the dashboard (SPEC §9.1) ----

/** How far back the dashboard looks for alerts sent to the flight surgeon. */
const RELAYED_ALERT_DAYS = 7;

export interface DashboardRelay {
  relay: RelayDelayResponse;
  notes: OnboardNote[];
  relayedAlerts: OnboardAlert[];
}

/** The alerts sent to the flight surgeon recently, for the red banners' countdown tag. */
export function loadRelayedAlerts(astronautId: string, nowMs: number): Promise<OnboardAlert[]> {
  return api.getRelayedAlerts(astronautId, { fromMs: nowMs - RELAYED_ALERT_DAYS * DAY_MS, toMs: endOfUtcDay(nowMs) });
}

export async function loadDashboardRelay(astronautId: string, nowMs: number): Promise<DashboardRelay> {
  const [relay, notes, relayedAlerts] = await Promise.all([api.getRelayDelay(), api.getNotes(astronautId), loadRelayedAlerts(astronautId, nowMs)]);
  return { relay, notes, relayedAlerts };
}

// ---- Mission Control (SPEC §9.2): ground endpoints only ----

/** A ground chart: the server's series up to now − the delay, drawn over `window`. */
function groundChartData(metric: ShownMetric, series: GroundSeriesResponse, window: TimeWindow): ChartData {
  return {
    points: fromSeriesPoints(series.points),
    unit: unitText(series.unit),
    decimals: METRIC_DISPLAY[metric].decimals,
    reference: series.reference,
    goal: null,
    window,
    timeUnit: "time",
    endsNow: false,
  };
}

/** The 6 hours leading up to an alert, for its card; null when the rule reads several (or hidden) metrics. */
export async function loadAlertChart(alert: GroundAlert): Promise<AlertChart | null> {
  const { metric } = alert;
  if (!metric || !isShownMetric(metric)) return null;
  const { fromMs, toMs, alertMs } = alertChartWindow(alert.at);
  const series = await api.getGroundSeries(metricOwner(metric, alert.astronautId), metric, {
    ...windowQuery({ fromMs, toMs }),
    bucket: ALERT_CHART_BUCKET_MINUTES,
  });
  return { data: groundChartData(metric, series, { fromMs, toMs }), alertMs };
}

/** One metric chart on the surgeon's astronaut page, over a range ending where the ground's data ends. */
export async function loadGroundChart(metric: ShownMetric, astronautId: string, range: SeriesRange): Promise<ChartData> {
  const series = await api.getGroundSeries(metricOwner(metric, astronautId), metric, seriesQuery(metric, range));
  const firstMs = series.points.length > 0 ? Date.parse(series.points[0].t) : null;
  return groundChartData(metric, series, chartWindow(range, Date.parse(series.dataAsOf), firstMs));
}

export interface GroundChartData {
  /** The ground series of each reading chart, by chart source key. */
  series: Map<string, ChartData>;
  /** The last daily log that reached the ground (check-ins, calories, exercise minutes). */
  dailyLog: GroundDailyLogResponse;
}

/** Fetches what the surgeon's astronaut page charts; astronautPanels (lib/domain) pairs it with the specs. */
export async function loadGroundCharts(specs: readonly GroundChartSpec[], astronautId: string, range: SeriesRange): Promise<GroundChartData> {
  const metricSources = specs.flatMap((spec) => (spec.source.kind === "metric" ? [spec.source] : []));
  const [dailyLog, series] = await Promise.all([
    api.getGroundDailyLog(astronautId),
    Promise.all(metricSources.map(async (source) => [chartSourceKey(source), await loadGroundChart(source.metric, astronautId, range)] as const)),
  ]);
  return { series: new Map(series), dailyLog };
}

export interface ConsoleData {
  crew: GroundCrewResponse;
  mission: GroundMissionResponse;
  alerts: GroundAlert[];
  notes: GroundNote[];
}

/** Everything the surgeon console shows, from the ground's side of the relay only. */
export async function loadConsole(nowMs: number): Promise<ConsoleData> {
  const alertWindow = { fromMs: nowMs - ALERT_FEED_DAYS * DAY_MS, toMs: endOfUtcDay(nowMs) };
  const [crew, mission, alerts, notes] = await Promise.all([api.getGroundCrew(), api.getGroundMission(), api.getGroundAlerts(alertWindow), api.getGroundNotes()]);
  return { crew, mission, alerts, notes };
}

/**
 * The demo storm's state for the console's demo control. It is read from the ship (a demo
 * control, not ground data); a failure is shown on the control instead of failing the console.
 */
export const loadSolarStorm = (): Promise<Loaded<SolarStormState>> => loadOrProblem(() => api.getSolarStorm());
