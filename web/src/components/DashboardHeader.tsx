import type { Astronaut, MissionResponse, PointsSummary, RelayDelayResponse } from "@heartbeat/shared";
import { formatMinutes, formatUtcClock } from "@/lib/domain/format";
import type { Loaded } from "@/lib/domain/onboard-response";
import { loadedPointsTile } from "@/lib/domain/points";
import { earthLinkTile } from "@/lib/domain/relay";
import type { DueTask } from "@/lib/domain/schedule";
import { CrewPicker } from "./CrewPicker";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./dashboard.module.css";

interface Tile {
  label: string;
  value: string;
  /** A sub-line under the value, when there is something to add. */
  detail?: string;
  /** How the value reads: a figure (mono, larger; the default) or words. */
  valueStyle?: "figure" | "text";
}

function missionTiles({ missionDay, gravity, startDate }: MissionResponse): Tile[] {
  return [
    { label: "Mission day", value: String(missionDay), detail: `since ${startDate}` },
    { label: "Gravity", value: gravity.label },
  ];
}

/** Points since mission day 1 and the measurement streak, from the server (SPEC §7). */
function pointsHeaderTile(points: Loaded<PointsSummary>): Tile {
  return { label: "Points · Streak", ...loadedPointsTile(points) };
}

function HeaderTile({ tile }: { tile: Tile }) {
  return (
    <div className={styles.tile}>
      <dt>{tile.label}</dt>
      <dd className={tile.valueStyle === "text" ? styles.tileText : styles.tileValue}>{tile.value}</dd>
      {tile.detail && <dd className={styles.tileDetail}>{tile.detail}</dd>}
    </div>
  );
}

function ReminderTile({ next }: { next: DueTask | null }) {
  return (
    <div className={`${styles.tile} ${styles.highlight}`}>
      <dt>Next reminder</dt>
      {next ? (
        <>
          <dd className={styles.highlightValue}>
            {next.task.label} · {formatUtcClock(next.dueAtMs)} UTC
          </dd>
          <dd className={styles.tileDetail}>due in {formatMinutes(next.minutesUntil)}</dd>
        </>
      ) : (
        <dd className={styles.highlightValue}>No timed tasks left</dd>
      )}
    </div>
  );
}

interface DashboardHeaderProps {
  crew: Astronaut[];
  astronaut: Astronaut;
  mission: MissionResponse;
  next: DueTask | null;
  /** A failed load shows "—" in the points tile only. */
  points: Loaded<PointsSummary>;
  /** The relay setting, for the Earth link tile's current delay. */
  relay: RelayDelayResponse;
  chooseAstronaut: (astronautId: string) => Promise<void>;
}

export function DashboardHeader({ crew, astronaut, mission, next, points, relay, chooseAstronaut }: DashboardHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <h1 className={styles.appName}>Heartbeat Telemetry</h1>
        <div className={styles.subtitle}>
          <CrewPicker crew={crew} selectedId={astronaut.id} choose={chooseAstronaut} />
          <span>{mission.name}</span>
        </div>
      </div>
      <dl className={styles.tiles}>
        {missionTiles(mission).map((tile) => (
          <HeaderTile key={tile.label} tile={tile} />
        ))}
        <HeaderTile tile={pointsHeaderTile(points)} />
        <ReminderTile next={next} />
        <HeaderTile tile={{ label: "Earth link", ...earthLinkTile(relay), valueStyle: "text" }} />
      </dl>
      <ThemeToggle />
    </header>
  );
}
