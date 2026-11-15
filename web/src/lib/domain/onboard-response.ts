// What to make of one onboard-server response: the decisions behind every fetch, kept pure so
// they can be unit-tested (the fetch shell in lib/onboard/http.ts is server-only).

import type { Guard } from "./guards";

const HTTP_NOT_FOUND = 404;

/** The server answered with an error status. */
export class OnboardApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Onboard server ${status} for ${path}: ${body}`);
    this.name = "OnboardApiError";
  }

  get isNotFound(): boolean {
    return this.status === HTTP_NOT_FOUND;
  }
}

/** The server answered, but not with the shape this app expects (or not with JSON). */
export class OnboardShapeError extends Error {
  constructor(readonly path: string) {
    super(`Onboard server response for ${path} does not have the expected shape`);
    this.name = "OnboardShapeError";
  }
}

/** Turns an HTTP status and body text into the checked value, or throws the matching error. */
export function readOnboardResponse<T>(httpStatus: number, path: string, bodyText: string, guard: Guard<T>): T {
  if (httpStatus < 200 || httpStatus >= 300) throw new OnboardApiError(httpStatus, path, bodyText);
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new OnboardShapeError(path);
  }
  if (!guard(body)) throw new OnboardShapeError(path);
  return body;
}

/** A status-like load whose failure the page shows inline rather than replacing the whole page. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; problem: string };

export async function loadOrProblem<T>(load: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    if (error instanceof OnboardApiError) return { ok: false, problem: `the onboard server answered HTTP ${error.status} for ${error.path}` };
    throw error;
  }
}
