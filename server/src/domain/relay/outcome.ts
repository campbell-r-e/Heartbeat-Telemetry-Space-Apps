/** Why a relay use case refused a request: a stable code the HTTP layer turns into a reply. */
export type RelayProblem = "unknown_astronaut" | "astronaut_exists" | "unknown_alert" | "invalid_transition" | "unknown_note";

/** A use case's result: the value, or the problem. */
export type Outcome<T, P extends RelayProblem> = { ok: true; value: T } | { ok: false; problem: P };

export const succeeded = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const failed = <P extends RelayProblem>(problem: P): { ok: false; problem: P } => ({ ok: false, problem });
