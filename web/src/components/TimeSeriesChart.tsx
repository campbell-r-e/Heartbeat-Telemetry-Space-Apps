"use client";

// One Recharts line chart for every chart in the app (SPEC §4), styled to the mockups: status-
// colored line, the server's normal band shaded and its alert thresholds dashed (decision 8),
// simulated data dashed, a UTC time axis ending at "now" (on the ground's charts, at the time their
// data ends), JetBrains Mono numbers. Limits are
// labeled in the legend under the chart (ChartFigure), never on the plot, so labels cannot collide.

import { Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { MARK_STYLE, bandEdges, chartRows, edgePaddingPx, timeExtent, timeTickLabel, timeTicks, valueAxis, type ChartData, type ChartRow } from "@/lib/domain/chart";
import { formatNumber } from "@/lib/domain/format";
import { TONE_COLOR, type Tone } from "@/lib/domain/status";

const SIZES = {
  mini: { height: 48, strokeWidth: 2, dotRadius: 2.5, margin: { top: 4, right: 2, bottom: 4, left: 2 } },
  /** The surgeon console's alert chart: the hours leading up to an alert (mockup: 90 px, no axes). */
  alert: { height: 90, strokeWidth: 2.5, dotRadius: 3, margin: { top: 4, right: 0, bottom: 4, left: 0 } },
  // The right margin fits half of the last time tick's label ("Nov 15 03:06"), which is centered on the plot's end.
  full: { height: 260, strokeWidth: 2.5, dotRadius: 3.5, margin: { top: 12, right: 44, bottom: 4, left: 0 } },
};

const TICK_STYLE = { fontFamily: "var(--font-mono)", fontSize: 12, fill: "var(--muted)" };
const Y_AXIS_WIDTH = 56;
const MARK_LINE_WIDTH = 1.5;

interface TimeSeriesChartProps {
  data: ChartData;
  /** Line color: the area's status tone (accent when there is no status). */
  tone: Tone;
  size: keyof typeof SIZES;
  /** A moment to mark with a dashed vertical line (the alert, on the surgeon console). */
  markerMs?: number;
}

/** Draws a dot only for a reading with no neighbor, so a lone reading is still visible. */
function loneDot(radius: number, color: string, key: keyof Pick<ChartRow, "recorded" | "simulated">) {
  function LoneDot(props: { cx?: number; cy?: number; payload?: ChartRow; index?: number }) {
    const { cx, cy, payload, index } = props;
    if (cx === undefined || cy === undefined || !payload?.lone || payload[key] === null) return <g key={index} />;
    return <circle key={index} cx={cx} cy={cy} r={radius} fill={color} />;
  }
  return LoneDot;
}

export function TimeSeriesChart({ data, tone, size, markerMs }: TimeSeriesChartProps) {
  const { height, strokeWidth, dotRadius, margin } = SIZES[size];
  const full = size === "full";
  const color = TONE_COLOR[tone];
  const extent = timeExtent(data);
  const yAxis = valueAxis(data.points, data.reference, data.goal, { decimals: data.decimals, scale: data.scale });
  const band = data.reference?.band ? bandEdges(data.reference.band, data.points) : null;
  const edge = edgePaddingPx(dotRadius, strokeWidth);

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 600, height }}>
      <LineChart data={chartRows(data.points)} margin={margin}>
        <XAxis
          dataKey="tMs"
          type="number"
          scale="time"
          domain={extent ? [extent.fromMs, extent.toMs] : ["dataMin", "dataMax"]}
          ticks={extent ? timeTicks(extent, data.timeUnit) : undefined}
          hide={!full}
          tickFormatter={(tMs: number) => (extent ? timeTickLabel(tMs, extent, data) : "")}
          tick={TICK_STYLE}
          stroke="var(--line)"
          padding={{ left: edge, right: edge }}
          allowDataOverflow
        />
        <YAxis hide={!full} padding={{ top: edge, bottom: edge }} domain={yAxis?.domain ?? ["auto", "auto"]} ticks={yAxis?.ticks} tickFormatter={(value: number) => formatNumber(value, data.decimals)} tick={TICK_STYLE} stroke="var(--line)" width={Y_AXIS_WIDTH} />
        {band && <ReferenceArea y1={band.low} y2={band.high} fill={MARK_STYLE.band.color} fillOpacity={1} />}
        {/* The mini chart shows only the band, as in the mockup; thresholds are on the full chart. */}
        {full &&
          data.reference?.thresholds.map((threshold) => (
            <ReferenceLine
              key={`${threshold.status}-${threshold.value}`}
              y={threshold.value}
              stroke={MARK_STYLE[threshold.status].color}
              strokeDasharray={MARK_STYLE[threshold.status].dash ?? undefined}
              strokeWidth={MARK_LINE_WIDTH}
            />
          ))}
        {full && data.goal && (
          <ReferenceLine y={data.goal.value} stroke={MARK_STYLE.goal.color} strokeWidth={MARK_LINE_WIDTH} strokeDasharray={MARK_STYLE.goal.dash ?? undefined} />
        )}
        {markerMs !== undefined && <ReferenceLine x={markerMs} stroke="var(--muted)" strokeDasharray="4 4" />}
        <Line dataKey="recorded" type="linear" stroke={color} strokeWidth={strokeWidth} dot={loneDot(dotRadius, color, "recorded")} activeDot={false} isAnimationActive={false} connectNulls={false} />
        <Line
          dataKey="simulated"
          type="linear"
          stroke={MARK_STYLE.simulated.color}
          strokeDasharray={MARK_STYLE.simulated.dash ?? undefined}
          strokeWidth={strokeWidth}
          dot={loneDot(dotRadius, MARK_STYLE.simulated.color, "simulated")}
          activeDot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
