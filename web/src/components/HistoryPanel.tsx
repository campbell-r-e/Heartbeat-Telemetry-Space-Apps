import type { AlertLogEntry } from "@heartbeat/shared";
import { formatUtcDateTime } from "@/lib/domain/format";
import { statusLook } from "@/lib/domain/status";
import { StatusPill } from "./StatusPill";
import styles from "./detail.module.css";

function changeText(entry: AlertLogEntry): string {
  return `${statusLook(entry.from).label} → ${statusLook(entry.to).label}`;
}

/** Status changes for this area from the server's alert log (decision 6), newest first. */
export function HistoryPanel({ log, days }: { log: AlertLogEntry[]; days: number }) {
  const entries = [...log].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section aria-labelledby="history-title" className="panel">
      <h2 id="history-title" className="panelTitle">
        History
      </h2>
      {entries.length === 0 ? (
        <p className={styles.pending}>No status changes recorded for this area in the last {days} days.</p>
      ) : (
        <ul className={styles.history}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles.historyItem}>
              <span className={styles.historyWhen}>{formatUtcDateTime(entry.at)}</span>
              <StatusPill status={entry.to} small />
              <span>
                <strong>{entry.title}</strong> ({changeText(entry)}){entry.message ? `. ${entry.message.what}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
