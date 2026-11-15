// Runs a task at a fixed interval. A tick that fails is reported, never left as an unhandled
// rejection (which would end the process), and a tick never starts while the last one runs.
import { reportSafely } from "./report-safely.ts";

export interface RepeatingJob {
  /** Stops the interval; resolves once a tick in progress has finished. */
  stop(): Promise<void>;
}

export function repeatEvery(intervalMs: number, tick: () => Promise<void>, onError: (error: unknown) => void): RepeatingJob {
  let running: Promise<void> | null = null;

  async function runOnce(): Promise<void> {
    try {
      await tick();
    } catch (error) {
      reportSafely(onError, error);
    } finally {
      running = null;
    }
  }

  const handle = setInterval(() => {
    running ??= runOnce();
  }, intervalMs);

  return {
    async stop() {
      clearInterval(handle);
      await running;
    },
  };
}
