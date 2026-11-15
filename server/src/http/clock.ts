/** The current time as an ISO string, the default for a write's optional timestamp. */
export function nowIso(now: () => number): string {
  return new Date(now()).toISOString();
}
