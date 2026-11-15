import type { Status } from "@heartbeat/shared";
import { statusLook } from "@/lib/domain/status";
import styles from "./status.module.css";

/** Status color plus symbol (● ▲ ■), or the neutral "No status" look when status is null. */
export function StatusPill({ status, small = false }: { status: Status | null; small?: boolean }) {
  const look = statusLook(status);
  return (
    <span data-tone={look.tone} className={`${styles.pill} ${small ? styles.small : ""}`}>
      <span aria-hidden="true">{look.symbol}&nbsp;</span>
      {look.label}
    </span>
  );
}

/** The server's reason for "No status" (decision 15), on its own full-width line under the pill. */
export function StatusReason({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return <p className={styles.reason}>No status: {reason}</p>;
}
