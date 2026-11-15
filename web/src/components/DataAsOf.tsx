"use client";

import { dataAsOfText } from "@/lib/domain/surgeon";
import styles from "./surgeon.module.css";
import { useNow } from "./useNow";

/** "01:06:24 UTC · 3 min ago": the newest snapshot the ground holds, its age updating every second. */
export function DataAsOf({ dataAsOf, nowMs }: { dataAsOf: string | null; nowMs: number }) {
  const now = useNow(nowMs);
  return <span className={styles.asOfValue}>{dataAsOfText(dataAsOf, now)}</span>;
}
