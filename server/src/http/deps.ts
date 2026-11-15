import type { CrewPoints } from "../domain/gamification/points-updates.ts";
import type { DailyLogChanges, Stores } from "../domain/ports.ts";
import type { OnboardCrew } from "../domain/relay/crew.ts";
import type { Relay } from "../domain/relay/relay.ts";
import type { SolarEventProfile } from "../domain/solar-storm.ts";
import type { RuleBook } from "../domain/rules/rule-book.ts";
import type { SleepDerivationJob } from "../jobs/sleep-derivation-job.ts";
import type { StatusEvaluator } from "../domain/status/status-evaluator.ts";
import type { LiveHub } from "./live.ts";

/** Everything the routes need, handed in by the composition root (src/index.ts) or a test. */
export interface AppDeps {
  stores: Stores;
  /** Shared secret required on every write. */
  token: string;
  /** The real 2017 event the solar storm demo replays. */
  solarEvent: SolarEventProfile;
  /** The one rules engine's rules and settings (SPEC §6). */
  ruleBook: RuleBook;
  now: () => number;
  /** The relay queue between the spacecraft and the ground (SPEC §8). */
  relay: Relay;
  /**
   * Evaluates and logs statuses one at a time, shared with the minute check; it tells the relay, so
   * 🔴 and 🟡 alerts and status snapshots go to the ground.
   */
  statusEvaluator: StatusEvaluator;
  /** WebSocket clients on /ws/onboard and /ws/ground. */
  live: LiveHub;
  /** The spacecraft's crew management; uploading watches report through it. */
  crew: Pick<OnboardCrew, "watchReported">;
  /** Told of writes to past days of a daily log, so the ground gets the corrected day (SPEC §8). */
  dailyLogChanges: DailyLogChanges;
  /** Tasks and points (SPEC §7): read through it, and told of writes that can complete or undo a task. */
  points: Pick<CrewPoints, "summary" | "todayTasks" | "activityChanged" | "historyChanged">;
  /** The one writer of derived sleep; a changed sleep-day time zone asks it to run now (SPEC §5.7). */
  sleepDerivation: Pick<SleepDerivationJob, "runNow">;
}
