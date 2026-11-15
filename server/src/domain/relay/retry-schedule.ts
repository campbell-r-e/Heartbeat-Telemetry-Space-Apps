// How long a failing arrival effect is retried before its event is set aside (owner decision):
// growing gaps from 5 s, doubling, each at most 2 minutes, for about 10 minutes in all. Pure.
import { MINUTE_MS } from "../time.ts";

/** The gap after the first failed attempt. */
export const FIRST_RETRY_GAP_MS = 5_000;
/** Each gap is this many times the one before it… */
export const RETRY_GAP_GROWTH = 2;
/** …but never longer than this. */
export const MAX_RETRY_GAP_MS = 2 * MINUTE_MS;
/** Once the gaps waited add up to this, the event is set aside and reported to the ground. */
export const GIVE_UP_AFTER_MS = 10 * MINUTE_MS;

/** The gap to wait after the `failedAttempts`-th failed attempt (1 = the first). */
export function retryGapMs(failedAttempts: number): number {
  return Math.min(FIRST_RETRY_GAP_MS * RETRY_GAP_GROWTH ** (failedAttempts - 1), MAX_RETRY_GAP_MS);
}

/** The time already spent waiting between `failedAttempts` failed attempts. */
export function retryTimeSpentMs(failedAttempts: number): number {
  let spent = 0;
  for (let attempt = 1; attempt < failedAttempts; attempt++) spent += retryGapMs(attempt);
  return spent;
}

/** True once the retries have taken GIVE_UP_AFTER_MS: the event is set aside. */
export function shouldSetAside(failedAttempts: number): boolean {
  return retryTimeSpentMs(failedAttempts) >= GIVE_UP_AFTER_MS;
}
