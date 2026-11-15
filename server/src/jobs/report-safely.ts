/**
 * Hands `error` to `onError`. A reporter that throws must not turn a job's handled failure into
 * a rejected promise (an unhandled rejection ends the process, and a rejected run chain skips
 * every later run), so its own error is dropped: nothing more can be done with it.
 */
export function reportSafely(onError: (error: unknown) => void, error: unknown): void {
  try {
    onError(error);
  } catch {
    // The reporter failed; the job carries on regardless.
  }
}
