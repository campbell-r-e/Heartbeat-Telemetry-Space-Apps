import type { ReactNode } from "react";
import type { ChartData, ChartReader } from "@/lib/domain/chart";
import type { Tone } from "@/lib/domain/status";
import { ChartFigure } from "./ChartFigure";
import styles from "./detail.module.css";

interface ChartPanelProps {
  title: string;
  data: ChartData;
  rangePhrase: string;
  tone: Tone;
  /** The main chart passes the range picker here. */
  controls?: ReactNode;
  reader?: ChartReader;
}

export function ChartPanel({ title, data, rangePhrase, tone, controls, reader }: ChartPanelProps) {
  return (
    <section aria-label={`${title} chart`} className="panel">
      <div className={styles.panelHead}>
        <h2 className="panelTitle">{title}</h2>
        {controls}
      </div>
      <ChartFigure title={title} data={data} rangePhrase={rangePhrase} tone={tone} reader={reader} />
    </section>
  );
}
