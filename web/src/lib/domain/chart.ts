// Shapes time series for the Recharts charts. Simulated points (the labeled solar storm demo) go
// in their own dashed series so the UI always marks them as simulated (SPEC §5.7, §10), and the
// line breaks at gaps in the data instead of bridging hours with no readings.

import type { ChartReference, ReferenceBasis, SeriesPoint, SeriesRange } from "@heartbeat/shared";
import { formatNumber, formatUtcClock, formatUtcDay } from "./format";
import { dayChartWindow, type TimeWindow } from "./ranges";
import { STATUS_LOOK, TONE_COLOR } from "./status";
import { DAY_MS } from "./time";

export interface ChartPoint {
  tMs: number;
  value: number;
  simulated: boolean;
}

/** A chart's points, how to label its values, and the server's reference lines (decision 8). */
export interface ChartData {
  points: ChartPoint[];
  unit: string;
  decimals: number;
  /** Normal band and alert thresholds from the server; null until it provides them. */
  reference: ChartReference | null;
  /** A goal line (the server's daily exercise goal), drawn and named in the legend; null for none. */
  goal: { value: number; label: string } | null;
  /** The time span the chart covers (the chosen range, ending now); null to fit the data. */
  window: TimeWindow | null;
  /** "time" for readings (the axis ends at "now"), "day" for one value per UTC day (the axis shows dates). */
  timeUnit: "time" | "day";
  /** A caveat to show under the chart, e.g. days whose total is a lower bound. */
  note?: string;
  /**
   * Whether the window ends at this moment, so its last tick reads "now" (the default). The ground's
   * charts end at now − the relay delay and label that tick with its time instead.
   */
  endsNow?: boolean;
  /** A fixed scale the value axis always spans (check-ins: 1–5); the axis still widens for data outside it. */
  scale?: ValueScale;
}

export interface ValueScale {
  min: number;
  max: number;
}

/** One Recharts row: a value in exactly the series it belongs to, null elsewhere. */
export interface ChartRow {
  tMs: number;
  recorded: number | null;
  simulated: number | null;
  /** A reading with no neighbor to join, drawn as a dot so it is not invisible. */
  lone: boolean;
}

export function fromSeriesPoints(points: readonly SeriesPoint[]): ChartPoint[] {
  return points.map((point) => ({ tMs: Date.parse(point.t), value: point.value, simulated: point.source === "simulated" }));
}

export function hasSimulated(points: readonly ChartPoint[]): boolean {
  return points.some((point) => point.simulated);
}

/** A gap is a spacing more than GAP_FACTOR times the median spacing between readings. */
const GAP_FACTOR = 3;

function gapThresholdMs(points: readonly ChartPoint[]): number {
  const spacings = points.slice(1).map((point, index) => point.tMs - points[index].tMs).sort((a, b) => a - b);
  if (spacings.length === 0) return Infinity;
  return spacings[Math.floor(spacings.length / 2)] * GAP_FACTOR;
}

/**
 * Rows for a line chart with a recorded and a simulated series. Where the two meet, the joining
 * reading appears in both so the line is continuous; after a gap, an empty row breaks the line.
 */
export function chartRows(points: readonly ChartPoint[]): ChartRow[] {
  const gapMs = gapThresholdMs(points);
  const isGapBefore = (index: number) => index === 0 || points[index].tMs - points[index - 1].tMs > gapMs;
  const isGapAfter = (index: number) => index === points.length - 1 || isGapBefore(index + 1);
  const rows: ChartRow[] = [];
  points.forEach((point, index) => {
    if (index > 0 && isGapBefore(index)) {
      rows.push({ tMs: (points[index - 1].tMs + point.tMs) / 2, recorded: null, simulated: null, lone: false });
    }
    const row: ChartRow = {
      tMs: point.tMs,
      recorded: point.simulated ? null : point.value,
      simulated: point.simulated ? point.value : null,
      lone: isGapBefore(index) && isGapAfter(index),
    };
    const previous = rows[rows.length - 1];
    if (!isGapBefore(index) && previous && points[index - 1].simulated !== point.simulated) {
      const joint = points[index - 1].value;
      if (point.simulated) previous.simulated = joint;
      else previous.recorded = joint;
    }
    rows.push(row);
  });
  return rows;
}

/** A time-axis tick in UTC: clock time, with the date once the chart spans more than a day. */
export function timeTick(tMs: number, spanMs: number): string {
  return spanMs > DAY_MS ? `${formatUtcDay(tMs)} ${formatUtcClock(tMs)}` : formatUtcClock(tMs);
}

export function timeSpanMs(points: readonly ChartPoint[]): number {
  return points.length < 2 ? 0 : points[points.length - 1].tMs - points[0].tMs;
}

/** Where the server's band and lines come from, as shown under a chart. */
export const BASIS_TEXT: Record<ReferenceBasis, string> = {
  settings: "from the onboard settings",
  baseline: "from your personal baseline",
  previousSevenDays: "from the previous 7 days",
};

/** Who reads a chart: the astronaut (their own data) or the flight surgeon (someone else's). */
export type ChartReader = "astronaut" | "surgeon";

/** Where the band and lines come from, worded for the reader ("your" baseline, or "the astronaut's"). */
export function basisText(basis: ReferenceBasis, reader: ChartReader = "astronaut"): string {
  return reader === "surgeon" && basis === "baseline" ? "from the astronaut's personal baseline" : BASIS_TEXT[basis];
}

export interface ReferenceItem {
  /** "band" for the shaded normal band, "goal" for a goal line, else the threshold's status. */
  kind: "band" | "goal" | "watch" | "alert";
  text: string;
}

/**
 * The server's band and lines as legend items, e.g. "Normal band: up to 2.5 mmHg". Shown beside the
 * chart rather than on it, so labels never collide with each other or the data line.
 */
export function referenceItems(data: Pick<ChartData, "reference" | "goal" | "unit" | "decimals">): ReferenceItem[] {
  const { reference, goal, unit, decimals } = data;
  const goalItems: ReferenceItem[] = goal ? [{ kind: "goal", text: `${goal.label}: ${formatNumber(goal.value, decimals)} ${unit}` }] : [];
  if (!reference) return goalItems;
  const format = (value: number) => `${formatNumber(value, decimals)} ${unit}`;
  const band = reference.band;
  const bandText =
    band === null ? null
    : band.low !== null && band.high !== null ? `Normal band: ${formatNumber(band.low, decimals)}–${format(band.high)}`
    : band.low !== null ? `Normal band: at least ${format(band.low)}`
    : band.high !== null ? `Normal band: up to ${format(band.high)}`
    : null;
  const lines = reference.thresholds.map((threshold): ReferenceItem => ({ kind: threshold.status, text: `${threshold.label}: ${format(threshold.value)}` }));
  return [...(bandText ? [{ kind: "band" as const, text: bandText }] : []), ...lines, ...goalItems];
}

/**
 * The band's edges to shade. An open bound (null) is drawn to the edge of what the chart shows
 * (the data and the band's other bound), so "up to 21 µGy/h" shades from the bottom, not the top.
 */
export function bandEdges(band: NonNullable<ChartReference["band"]>, points: readonly ChartPoint[]): { low: number; high: number } | null {
  const known = [...points.map((point) => point.value), ...[band.low, band.high].filter((bound): bound is number => bound !== null)];
  if (known.length === 0) return null;
  return { low: band.low ?? Math.min(...known), high: band.high ?? Math.max(...known) };
}

/** Share of the value span added above and below, so lines never sit on the chart's edge. */
const DOMAIN_PAD = 0.08;
/** About how many intervals the value axis is split into. */
const AXIS_INTERVALS = 5;
/** Steps the value axis may use, times a power of ten. */
const NICE_MULTIPLES = [1, 2, 2.5, 5, 10];

/** How the value axis labels its ticks: the chart's decimals, and its fixed scale if it has one. */
export interface AxisOptions {
  /** Decimals the tick labels show; the axis never steps finer than one unit of the last decimal. */
  decimals?: number;
  scale?: ValueScale;
}

/**
 * The smallest step whose ticks still read differently with `decimals` decimals (1 for whole
 * numbers), so no two ticks ever show the same label.
 */
function axisStep(span: number, decimals: number | undefined): number {
  const step = niceStep(span / AXIS_INTERVALS);
  return decimals === undefined ? step : Math.max(step, 10 ** -decimals);
}

/**
 * The value axis: fits the data and every server limit (finite band bounds and thresholds) with a
 * little room, and never dips below zero for data that cannot be negative. A chart with a fixed
 * scale spans exactly that scale (wider only for data outside it). A single value, or all-equal
 * values, still gets a span of whole label steps around it.
 */
export function valueDomain(
  points: readonly ChartPoint[], reference: ChartReference | null, goal: ChartData["goal"] = null, axis: AxisOptions = {},
): [number, number] | null {
  const limits = [...(reference ? [reference.band?.low, reference.band?.high, ...reference.thresholds.map((t) => t.value)] : []), goal?.value];
  const values = [...points.map((point) => point.value), ...limits.filter((value): value is number => typeof value === "number")];
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (axis.scale) return [Math.min(axis.scale.min, min), Math.max(axis.scale.max, max)];
  const pad = (max - min || Math.abs(max) || 1) * DOMAIN_PAD;
  const paddedLow = min >= 0 ? Math.max(0, min - pad) : min - pad;
  const step = axisStep(max + pad - paddedLow, axis.decimals);
  return [Math.floor(paddedLow / step) * step, Math.ceil((max + pad) / step) * step];
}

/** The value axis's span and its ticks, computed together so the ticks always match the span's step. */
export function valueAxis(
  points: readonly ChartPoint[], reference: ChartReference | null, goal: ChartData["goal"], axis: AxisOptions,
): { domain: [number, number]; ticks: number[] } | null {
  const domain = valueDomain(points, reference, goal, axis);
  return domain && { domain, ticks: valueTicks(domain, axis.decimals) };
}

/** Round-number ticks across a value domain from valueDomain, one per nice step, never two with the same label. */
export function valueTicks([low, high]: [number, number], decimals?: number): number[] {
  const step = axisStep(high - low, decimals);
  const count = Math.round((high - low) / step);
  return Array.from({ length: count + 1 }, (_, i) => low + i * step);
}

/** The smallest 1, 2, 2.5 or 5 × 10ⁿ at least `rough`, so axis ends land on round numbers. */
export function niceStep(rough: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const multiple = NICE_MULTIPLES.find((candidate) => candidate * magnitude >= rough) ?? NICE_MULTIPLES[NICE_MULTIPLES.length - 1];
  return multiple * magnitude;
}

/**
 * Room, in pixels, between the plot's edges and its first and last values, so a dot or line end at
 * the edge (a reading taken at the window's end, a check-in of 5) is drawn whole, not cut in half:
 * the dot's radius or half the line's width, whichever is larger, rounded up.
 */
export function edgePaddingPx(dotRadius: number, strokeWidth: number): number {
  return Math.ceil(Math.max(dotRadius, strokeWidth / 2));
}

/** Where the time axis starts and ends: the chosen window, or the data when there is none. */
export function timeExtent(data: Pick<ChartData, "points" | "window">): TimeWindow | null {
  if (data.window) return data.window;
  if (data.points.length === 0) return null;
  return { fromMs: data.points[0].tMs, toMs: data.points[data.points.length - 1].tMs };
}

const TIME_TICK_COUNT = 5;

/** Daily charts label every day up to this many days, then every Nth day. */
const MAX_DAILY_TICKS = 10;

/**
 * Evenly spaced ticks across the extent, the last one at its end. Daily charts tick whole UTC days:
 * every day up to MAX_DAILY_TICKS, then an even step of days counted back from the last day, so the
 * spacing never changes and today is always labeled.
 */
export function timeTicks(extent: TimeWindow, unit: ChartData["timeUnit"], count = TIME_TICK_COUNT): number[] {
  const span = extent.toMs - extent.fromMs;
  if (span <= 0) return [extent.toMs];
  if (unit === "time") return Array.from({ length: count }, (_, i) => extent.fromMs + (span * i) / (count - 1));
  const days = Math.round(span / DAY_MS) + 1;
  const stepDays = days <= MAX_DAILY_TICKS ? 1 : Math.ceil((days - 1) / (MAX_DAILY_TICKS - 1));
  const tickCount = Math.floor((days - 1) / stepDays) + 1;
  return Array.from({ length: tickCount }, (_, i) => extent.toMs - (tickCount - 1 - i) * stepDays * DAY_MS);
}

/** A tick's text: dates for daily charts; "now" at the end of a window that ends now; else the UTC time. */
export function timeTickLabel(tMs: number, extent: TimeWindow, data: Pick<ChartData, "window" | "timeUnit" | "endsNow">): string {
  if (data.timeUnit === "day") return formatUtcDay(tMs);
  if (data.window !== null && data.endsNow !== false && tMs === extent.toMs) return "now";
  return timeTick(tMs, extent.toMs - extent.fromMs);
}

/** The latest reading, for a chart's text alternative. */
export function latestPoint(points: readonly ChartPoint[]): ChartPoint | null {
  return points.length === 0 ? null : points[points.length - 1];
}

/** Everything a chart draws besides the recorded line: the server's band and lines, a goal, simulated data. */
export type MarkKind = ReferenceItem["kind"] | "simulated";

export interface MarkStyle {
  color: string;
  /** SVG stroke-dasharray, or null for a filled area (the band). */
  dash: string | null;
  /** The outline of a filled area's legend swatch. */
  edge?: string;
}

/** How each mark looks, defined once: the plot draws with it and the legend swatches copy it. */
export const MARK_STYLE: Record<MarkKind, MarkStyle> = {
  band: { color: "var(--okbg)", dash: null, edge: TONE_COLOR[STATUS_LOOK.normal.tone] },
  goal: { color: TONE_COLOR[STATUS_LOOK.normal.tone], dash: "2 4" },
  watch: { color: TONE_COLOR[STATUS_LOOK.watch.tone], dash: "6 6" },
  alert: { color: TONE_COLOR[STATUS_LOOK.alert.tone], dash: "6 6" },
  simulated: { color: "var(--text)", dash: "5 4" },
};

/**
 * The chart data of a once-per-UTC-day series (calories, exercise minutes): its window runs over
 * whole days ending today and its axis shows dates.
 */
export function dailyChartData(
  points: ChartPoint[],
  options: { unit: string; range: SeriesRange; nowMs: number; goal?: ChartData["goal"]; note?: string },
): ChartData {
  return {
    points,
    unit: options.unit,
    decimals: 0,
    reference: null,
    goal: options.goal ?? null,
    window: dayChartWindow(options.range, options.nowMs, points[0]?.tMs ?? null),
    timeUnit: "day",
    note: options.note,
  };
}
