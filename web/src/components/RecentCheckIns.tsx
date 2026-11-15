import Link from "next/link";
import type { CheckIn } from "@heartbeat/shared";
import type { FormAction } from "@/lib/action-result";
import { detailPath } from "@/lib/domain/areas";
import { CHECK_IN_HISTORY_DAYS } from "@/lib/domain/checkin";
import { formatUtcDateTime } from "@/lib/domain/format";
import { ActionButton } from "./ActionButton";
import styles from "./checkin.module.css";

interface RecentCheckInsProps {
  /** Newest first. */
  checkIns: CheckIn[];
  astronautId: string;
  /** Removes a mistaken check-in (decision 12). */
  removeCheckIn: FormAction;
}

/** The last two weeks of check-ins, as in the approved mockup, each removable. */
export function RecentCheckIns({ checkIns, astronautId, removeCheckIn }: RecentCheckInsProps) {
  return (
    <aside aria-labelledby="recent-title" className="panel">
      <h2 id="recent-title" className="panelTitle">
        Last {CHECK_IN_HISTORY_DAYS} days
      </h2>
      {checkIns.length === 0 ? (
        <p className="muted">No check-ins yet.</p>
      ) : (
        <ul className={styles.recent}>
          {checkIns.map((checkIn) => {
            const when = formatUtcDateTime(checkIn.at);
            return (
              <li key={checkIn.id} className={styles.recentItem}>
                <span className={styles.recentWhen}>{when}</span>
                <span className={styles.recentScores}>
                  Mood {checkIn.mood} · Stress {checkIn.stress}
                </span>
                <ActionButton
                  action={removeCheckIn}
                  fields={{ astronautId, checkInId: String(checkIn.id) }}
                  label="×"
                  accessibleLabel={`Remove the check-in from ${when}`}
                  className={styles.remove}
                />
              </li>
            );
          })}
        </ul>
      )}
      <Link href={detailPath("mind")}>Mind details and learn more</Link>
    </aside>
  );
}
