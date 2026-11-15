import type { ChartData } from "@/lib/domain/chart";
import type { Tone } from "@/lib/domain/status";
import { TimeSeriesChart } from "./TimeSeriesChart";
import styles from "./charts.module.css";

/** The card's mini chart, with the server's normal band when it provides one. */
export function Sparkline({ data, tone }: { data: ChartData; tone: Tone }) {
  if (data.points.length === 0) return <div className={`${styles.empty} ${styles.emptyMini}`}>No data in this window yet</div>;
  return (
    <div aria-hidden="true">
      <TimeSeriesChart data={data} tone={tone} size="mini" />
    </div>
  );
}
