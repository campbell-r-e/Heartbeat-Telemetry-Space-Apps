"use client";

import type { OnboardAlert } from "@heartbeat/shared";
import { bannerRelayText } from "@/lib/domain/relay";
import styles from "./status.module.css";
import { useNow } from "./useNow";

/** The red banner's "Alert sent to flight surgeon · arrives in m:ss" tag, counting down to the server's deliverAt. */
export function RelayTag({ alert, nowMs }: { alert: Pick<OnboardAlert, "deliverAt" | "handling">; nowMs: number }) {
  const now = useNow(nowMs);
  return <span className={styles.relayTag}>{bannerRelayText(alert, now)}</span>;
}
