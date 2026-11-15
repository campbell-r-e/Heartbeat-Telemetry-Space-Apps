// The sleep derivation job for HTTP tests, wired as src/index.ts wires it but not started: only a
// route asking it to run now (a sleep-day time zone change) runs it.
import type { Stores } from "../../src/domain/ports.ts";
import { createSleepDerivationJob, type SleepDerivationJob } from "../../src/jobs/sleep-derivation-job.ts";

export interface TestSleepDerivation {
  job: SleepDerivationJob;
  /** Failures the job reported; tests expect none. */
  errors: unknown[];
}

export function testSleepDerivation(stores: Stores, now: () => number): TestSleepDerivation {
  const errors: unknown[] = [];
  const job = createSleepDerivationJob({
    stores, now,
    onAstronautFailed: (_astronautId, error) => errors.push(error),
    onError: (error) => errors.push(error),
  });
  return { job, errors };
}
