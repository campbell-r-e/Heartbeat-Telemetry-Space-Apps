// The result a dashboard write (server action) hands back to its form, and how a failed write
// becomes one. Shared by the actions and the components that show results.

import { isRecord } from "./domain/guards";
import { OnboardApiError } from "./domain/onboard-response";

export type ActionResult = { ok: boolean; message: string } | null;

/** A server action as a component receives it (passed down as a prop). */
export type FormAction = (previous: ActionResult, form: FormData) => Promise<ActionResult>;

export const failed = (message: string): ActionResult => ({ ok: false, message });
export const succeeded = (message: string): ActionResult => ({ ok: true, message });

/**
 * A rejection by the onboard server becomes a message the form shows; anything else (a network
 * failure, a shape error, a bug) is rethrown so the error page reports it.
 */
export function rejectionResult(error: unknown): ActionResult {
  if (!(error instanceof OnboardApiError)) throw error;
  const reason = serverMessage(error.body);
  return failed(reason ? `The onboard server refused this (HTTP ${error.status}): ${reason}.` : `The onboard server refused this (HTTP ${error.status}). Please try again.`);
}

/** The server's own explanation, when its error body has one (`{ error, message }`). */
function serverMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) && typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}
