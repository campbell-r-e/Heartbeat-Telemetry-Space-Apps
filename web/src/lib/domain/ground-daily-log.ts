// The surgeon's charts of an astronaut's daily logs (SPEC §9.2): mood and stress check-ins,
// calories per day and exercise minutes per day, from the last daily log that reached the ground.
// Every value was counted on board; this module only picks the chart's window and points.

import type { DailyCalories, DailyLog, ExerciseDay, SeriesRange } from "@heartbeat/shared";
import { CHART_SOURCE_TRAITS, type ChartSource } from "./area-charts";
import { dailyChartData, type ChartData, type ChartPoint } from "./chart";
import { checkInChartData } from "./checkin";
import { exerciseChartData } from "./exercise";
import { partialDaysNote } from "./nutrition";
import { dayChartWindow, rangeOption, type TimeWindow } from "./ranges";

/** Daily charts make sense over days: the ground shows them over 7 days, or the mission. */
export function dailyRange(range: SeriesRange): SeriesRange {
  return range === "mission" ? "mission" : "7d";
}

/** The range a chart of this source is drawn over: daily charts never go below 7 days. */
function sourceRange(source: ChartSource, range: SeriesRange): SeriesRange {
  return CHART_SOURCE_TRAITS[source.kind].daily ? dailyRange(range) : range;
}

/** The phrase under a chart of this source over the chosen range ("the last 7 days" for a daily chart on 1 h). */
export function groundRangePhrase(source: ChartSource, range: SeriesRange): string {
  return rangeOption(sourceRange(source, range)).phrase;
}

const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * The days a daily chart shows, ending on the day the log was read on board. Days outside it are
 * left out before the chart is built, so its notes speak only of the days drawn.
 */
function daysInWindow<T extends { day: string }>(days: readonly T[], range: SeriesRange, asOfMs: number): T[] {
  const firstMs = days.length > 0 ? dayStartMs(days[0].day) : null;
  const window: TimeWindow = dayChartWindow(range, asOfMs, firstMs);
  return days.filter((day) => dayStartMs(day.day) >= window.fromMs && dayStartMs(day.day) <= window.toMs);
}

function caloriePoints(days: readonly DailyCalories[]): ChartPoint[] {
  return days.map((day) => ({ tMs: dayStartMs(day.day), value: day.kcalAtLeast, simulated: false }));
}

function calorieChart(days: readonly DailyCalories[], range: SeriesRange, asOfMs: number): ChartData {
  const shown = daysInWindow(days, range, asOfMs);
  const partial = shown.filter((day) => day.mealsWithoutKcal > 0).length;
  return dailyChartData(caloriePoints(shown), { unit: "kcal", range, nowMs: asOfMs, note: partialDaysNote(partial) });
}

function exerciseChart(days: readonly ExerciseDay[], range: SeriesRange, asOfMs: number): ChartData {
  return exerciseChartData(daysInWindow(days, range, asOfMs), range, asOfMs);
}

/**
 * A daily-log chart over `range`, ending when the log was read on board (what the ground can know).
 * Null for a source the daily log does not carry (a metric).
 */
export function dailyLogChart(source: ChartSource, log: DailyLog, range: SeriesRange): ChartData | null {
  const asOfMs = Date.parse(log.at);
  const shownRange = sourceRange(source, range);
  switch (source.kind) {
    case "checkIns":
      return { ...checkInChartData(log.checkIns, source.field, shownRange, asOfMs), endsNow: false };
    case "dailyCalories":
      return calorieChart(log.calories, shownRange, asOfMs);
    case "exerciseDays":
      return exerciseChart(log.exercise, shownRange, asOfMs);
    case "metric":
      return null;
  }
}
