// The surgeon's astronaut page ("View full charts", SPEC §9.2): which chart each panel shows, its
// title, tone and range phrase, and the page's subtitle. Pure: the loader fetches, the page renders.

import type { DailyLog, GroundCrewMember, SeriesRange, Status } from "@heartbeat/shared";
import { CHART_SOURCE_TRAITS, chartSourceKey } from "./area-charts";
import { findArea } from "./areas";
import type { ChartData } from "./chart";
import { formatDelay, formatUtcDateTime } from "./format";
import { dailyLogChart, groundRangePhrase } from "./ground-daily-log";
import { areaStatus, statusLook, type Tone } from "./status";
import { watchLine, type GroundChartSpec } from "./surgeon";

/** Shown in a daily-log panel before any daily log has reached the ground. */
export const NO_DAILY_LOG_TEXT = "No daily log from the spacecraft has reached the ground yet.";
/** Shown in a reading panel whose series did not load. */
export const NO_SERIES_TEXT = "No readings have reached the ground for this chart.";

export interface AstronautPanel {
  /** Unique per panel (the chart source's key). */
  key: string;
  title: string;
  tone: Tone;
  rangePhrase: string;
  /** The chart, or null with `emptyText` shown instead. */
  data: ChartData | null;
  emptyText: string;
  /** The first panel carries the range picker. */
  showsRangePicker: boolean;
}

export interface PanelInputs {
  specs: readonly GroundChartSpec[];
  /** The ground series loaded for the reading charts, by chart source key. */
  series: ReadonlyMap<string, ChartData>;
  /** The last daily log that reached the ground, or null before the first. */
  dailyLog: DailyLog | null;
  range: SeriesRange;
  member: GroundCrewMember | null;
}

/** One panel per chart, each paired with its own data by key: readings from the series, the rest from the daily log. */
export function astronautPanels({ specs, series, dailyLog, range, member }: PanelInputs): AstronautPanel[] {
  return specs.map((spec, index) => {
    const key = chartSourceKey(spec.source);
    const fromDailyLog = CHART_SOURCE_TRAITS[spec.source.kind].fromDailyLog;
    const data = fromDailyLog ? (dailyLog && dailyLogChart(spec.source, dailyLog, range)) : (series.get(key) ?? null);
    return {
      key,
      title: `${spec.title} · ${findArea(spec.area)?.title ?? spec.area}`,
      tone: statusLook(areaStatus(member?.status ?? null, spec.area)).tone,
      rangePhrase: groundRangePhrase(spec.source, range),
      data,
      emptyText: fromDailyLog ? NO_DAILY_LOG_TEXT : NO_SERIES_TEXT,
      showsRangePicker: index === 0,
    };
  });
}

export interface AstronautHeader {
  name: string;
  status: Status | null;
  subtitle: string;
}

/** The page header: the astronaut, their overall status, and where the page's data stands. */
export function astronautHeader(input: {
  astronautId: string; member: GroundCrewMember | null; oneWayDelayMs: number; dailyLogReceivedAt: string | null; nowMs: number;
}): AstronautHeader {
  const { astronautId, member, oneWayDelayMs, dailyLogReceivedAt, nowMs } = input;
  const dailyLog = dailyLogReceivedAt ? `daily log received ${formatUtcDateTime(dailyLogReceivedAt)}` : "no daily log received yet";
  const watch = member ? watchLine(member.watch, nowMs) : "Not on the crew roster";
  return {
    name: member?.name ?? astronautId,
    status: member?.status?.overall ?? null,
    subtitle: `Mission Control view · readings up to now − the link delay (${formatDelay(oneWayDelayMs)}) · ${dailyLog} · ${watch}`,
  };
}
