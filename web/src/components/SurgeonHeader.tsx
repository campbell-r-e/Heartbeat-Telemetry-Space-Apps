import type { RelayDelayResponse } from "@heartbeat/shared";
import type { FormAction } from "@/lib/action-result";
import { delayOptions } from "@/lib/domain/surgeon";
import { DataAsOf } from "./DataAsOf";
import { DelayControl } from "./DelayControl";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./surgeon.module.css";

interface SurgeonHeaderProps {
  missionLine: string;
  relay: RelayDelayResponse;
  /** The newest status snapshot's time on board, or null before the first. */
  dataAsOf: string | null;
  nowMs: number;
  changeDelay: FormAction;
}

/** Mission Control's header: mission and crew, the link delay preset, "Data as of", theme. */
export function SurgeonHeader({ missionLine, relay, dataAsOf, nowMs, changeDelay }: SurgeonHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <h1 className={styles.appName}>Mission Control · Flight Surgeon</h1>
        <span className={styles.subtitle}>{missionLine}</span>
      </div>
      <DelayControl options={delayOptions(relay)} realTime={relay.realTime} change={changeDelay} />
      <div className={styles.asOf}>
        <span className={styles.asOfLabel}>Data as of</span>
        <DataAsOf dataAsOf={dataAsOf} nowMs={nowMs} />
      </div>
      <ThemeToggle />
    </header>
  );
}
