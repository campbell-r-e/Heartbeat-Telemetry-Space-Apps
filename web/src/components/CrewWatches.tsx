import type { GroundCrewResponse } from "@heartbeat/shared";
import type { FormAction } from "@/lib/action-result";
import { formatDelay, formatUtcDateTime } from "@/lib/domain/format";
import { batteryText, crewNames, describeChange, otherWatches, rosterRows, spareWatchText, watchLine } from "@/lib/domain/surgeon";
import { AddAstronautForm, AssignWatchForm, RowActions, SyncCell, type CrewActionSet } from "./CrewRowParts";
import styles from "./surgeon.module.css";

const ClockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

interface CrewWatchesProps {
  ground: GroundCrewResponse;
  nowMs: number;
  actions: CrewActionSet & { addAstronaut: FormAction };
}

/**
 * The Crew & Watches tab (SPEC §9.2): the crew with each watch's last contact and battery, changes on
 * their way ("Sending"), watches no one wears, and changes the spacecraft could not apply.
 */
export function CrewWatches({ ground, nowMs, actions }: CrewWatchesProps) {
  const rows = rosterRows(ground, nowMs);
  const names = crewNames([...ground.crew, ...rows]);
  const crewChoices = ground.crew.map((member) => ({ astronautId: member.astronautId, name: member.name }));
  const { addAstronaut, ...rowActions } = actions;

  return (
    <div className={styles.crewTab}>
      <p className={styles.info}>
        <ClockIcon />
        <span>Changes reach the spacecraft after the link delay ({formatDelay(ground.relay.oneWayDelayMs)}). Pending changes show as &quot;Sending&quot;.</span>
      </p>

      <section aria-label="Crew" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Crew</h2>
          <AddAstronautForm addAstronaut={addAstronaut} />
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Astronaut</th>
                <th scope="col">Watch</th>
                <th scope="col">Last contact</th>
                <th scope="col">Battery</th>
                <th scope="col">Sync</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.astronautId}>
                  <td className={styles.nameCell}>{row.name}</td>
                  <td className={styles.watchCell}>{row.watchText}</td>
                  <td className={styles.monoCell}>{row.contact}</td>
                  <td className={styles.monoCell}>{row.battery}</td>
                  <td>
                    <SyncCell arrivesOnboardAt={row.pending?.arrivesOnboardAt ?? null} nowMs={nowMs} />
                  </td>
                  <td>
                    {row.onRoster && (
                      <RowActions
                        astronautId={row.astronautId}
                        name={row.name}
                        hasWatch={row.watch !== null}
                        watchChoices={otherWatches(ground, row.astronautId).map((watch) => ({
                          watchId: watch.watchId,
                          label: watchLine(watch, nowMs),
                        }))}
                        {...rowActions}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Unassigned watches" className={styles.section}>
        <h2 className={styles.sectionTitle}>Unassigned watches</h2>
        {ground.unassignedWatches.length === 0 && <p className="muted">No unassigned watches. A watch shows here after its first upload, until it is assigned.</p>}
        {ground.unassignedWatches.map((watch) => (
          <div key={watch.watchId} className={styles.watchRow}>
            <span className={styles.watchName}>{spareWatchText(watch, nowMs)}</span>
            <span className={styles.watchBattery}>Battery {batteryText(watch)}</span>
            <AssignWatchForm watchId={watch.watchId} crew={crewChoices} assignWatch={rowActions.assignWatch} />
          </div>
        ))}
      </section>

      {ground.failedChanges.length > 0 && (
        <section aria-label="Failed changes" className={styles.section}>
          <h2 className={styles.sectionTitle}>Changes the spacecraft could not apply</h2>
          <ul className={styles.failedList}>
            {ground.failedChanges.map((failure) => (
              <li key={failure.changeId} className={styles.failedItem}>
                <span className={styles.failedWhat}>■ {describeChange(failure.change, names)}</span>
                <span>{failure.reason}</span>
                <span className={styles.failedMeta}>Report received {formatUtcDateTime(failure.receivedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
