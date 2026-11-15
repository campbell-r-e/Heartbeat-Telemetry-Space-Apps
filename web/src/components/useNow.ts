"use client";

import { useEffect, useState } from "react";
import { SECOND_MS } from "@/lib/domain/time";

/**
 * The current time, ticking every second, for countdowns to times the server gave. It starts at the
 * request's time (`initialMs`, from the page) so the server render and the first client render match.
 */
export function useNow(initialMs: number): number {
  const [nowMs, setNowMs] = useState(initialMs);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}
