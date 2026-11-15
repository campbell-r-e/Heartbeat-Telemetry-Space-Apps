import { MARK_STYLE, basisText, type ChartReader, hasSimulated, latestPoint, referenceItems, type ChartData, type MarkKind, type ReferenceItem } from "@/lib/domain/chart";
import { formatNumber, formatUtcDateTime } from "@/lib/domain/format";
import type { Tone } from "@/lib/domain/status";
import { TimeSeriesChart } from "./TimeSeriesChart";
import styles from "./charts.module.css";

/** The chart's text alternative: what, over which range, its spread and its latest reading. */
function describe(title: string, data: ChartData, rangePhrase: string): string {
  const format = (value: number) => `${formatNumber(value, data.decimals)} ${data.unit}`;
  const values = data.points.map((point) => point.value);
  const latest = latestPoint(data.points);
  const latestText = latest ? ` Latest ${format(latest.value)} at ${formatUtcDateTime(latest.tMs)}.` : "";
  const simulated = hasSimulated(data.points) ? " Includes simulated data." : "";
  return `${title} over ${rangePhrase}: ${data.points.length} readings from ${format(Math.min(...values))} to ${format(Math.max(...values))}.${latestText}${simulated}`;
}

const SWATCH = { width: 18, height: 10, lineWidth: 2 };

/** A small drawing of a mark in the plot's own style (MARK_STYLE): a filled band or a dashed line. */
function Swatch({ kind }: { kind: MarkKind }) {
  const { color, dash, edge } = MARK_STYLE[kind];
  return (
    <svg width={SWATCH.width} height={SWATCH.height} aria-hidden="true" className={styles.swatch}>
      {dash === null ? (
        <rect width={SWATCH.width} height={SWATCH.height} rx={2} fill={color} stroke={edge} />
      ) : (
        <line x1={0} x2={SWATCH.width} y1={SWATCH.height / 2} y2={SWATCH.height / 2} stroke={color} strokeWidth={SWATCH.lineWidth} strokeDasharray={dash} />
      )}
    </svg>
  );
}

function LegendItem({ kind, text }: { kind: MarkKind; text: string }) {
  return (
    <li className={styles.legendItem}>
      <Swatch kind={kind} />
      {text}
    </li>
  );
}

/** The legend entries: the server's band and lines, the goal, and the simulated series when present. */
function legendEntries(data: ChartData): { kind: MarkKind; text: string }[] {
  const simulated = hasSimulated(data.points) ? [{ kind: "simulated" as const, text: "Simulated deep-space solar storm (demo data)" }] : [];
  return [...referenceItems(data).map((item: ReferenceItem) => ({ kind: item.kind, text: item.text })), ...simulated];
}

/**
 * A detail-page chart over the chosen range: the plot, its text alternative, and a legend naming the
 * server's band and lines (decision 8), the simulated series and the data basis.
 */
interface ChartFigureProps {
  title: string;
  data: ChartData;
  rangePhrase: string;
  tone: Tone;
  /** Words the band's basis for its reader; the astronaut by default. */
  reader?: ChartReader;
}

export function ChartFigure({ title, data, rangePhrase, tone, reader = "astronaut" }: ChartFigureProps) {
  if (data.points.length === 0) return <div className={`${styles.empty} ${styles.emptyFull}`}>No data in {rangePhrase}.</div>;
  const items = legendEntries(data);
  return (
    <figure className={styles.figure}>
      <span className={styles.unitLabel} aria-hidden="true">
        {data.unit}
      </span>
      <div role="img" aria-label={describe(title, data, rangePhrase)}>
        <TimeSeriesChart data={data} tone={tone} size="full" />
      </div>
      <span className={styles.axisNote} aria-hidden="true">
        {data.timeUnit === "day" ? "Day (UTC)" : "Time (UTC)"}
      </span>
      <figcaption className={styles.caption}>
        {items.length > 0 && (
          <ul className={styles.legend}>
            {items.map((item) => (
              <LegendItem key={item.text} kind={item.kind} text={item.text} />
            ))}
          </ul>
        )}
        {data.reference && <span>Band and lines {basisText(data.reference.basis, reader)}.</span>}
        {data.note && <span>{data.note}</span>}
      </figcaption>
    </figure>
  );
}
