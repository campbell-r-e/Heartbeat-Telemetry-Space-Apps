// Composition root: wires configuration, Postgres, bundled data, the owner's schedule, the relay
// and the HTTP app together.
import { readConfig } from "./config.ts";
import { readBundledData } from "./data/bundled-files.ts";
import { loadBundledData } from "./data/load-bundled.ts";
import { createPool, createSchema, createServicePool, postgresStores } from "./db/index.ts";
import { crewPoints } from "./domain/gamification/points-updates.ts";
import { DEFAULT_MISSION } from "./domain/mission.ts";
import { DEFAULT_RULE_BOOK } from "./domain/rules/rule-book.ts";
import { DEFAULT_SCHEDULE } from "./domain/schedule.ts";
import { solarEventProfile } from "./domain/solar-storm.ts";
import { createStatusEvaluator } from "./domain/status/status-evaluator.ts";
import { buildApp } from "./http/app.ts";
import { createLiveHub } from "./http/live.ts";
import { repeatEvery } from "./jobs/repeating-job.ts";
import { createSleepDerivationJob } from "./jobs/sleep-derivation-job.ts";
import { createRelaySystem } from "./relay-system.ts";
import { shutdownInOrder } from "./shutdown.ts";

/** How often every astronaut's status is evaluated for the alert log. */
const STATUS_EVALUATION_INTERVAL_MS = 60_000;


const config = readConfig();
const bundle = readBundledData();
// The schema and the bundled history load on a pool of their own with no statement time limit
// (large one-off writes); everything after runs on the service pool, whose statements time out.
const importPool = createPool();
await createSchema(importPool);
const loaded = await loadBundledData(postgresStores(importPool), bundle);
await importPool.end();
const pool = createServicePool();
const stores = postgresStores(pool);
const scheduledTasks = await stores.schedule.replace(DEFAULT_SCHEDULE);
await stores.mission.saveIfMissing(DEFAULT_MISSION);

// One rule book and one clock for the routes and the alert-log timer alike.
const ruleBook = DEFAULT_RULE_BOOK;
const now = Date.now;

const live = createLiveHub((err) => app.log.warn({ err }, "WebSocket client dropped"));
// Tasks and points (SPEC §7): pushed live when a task becomes done or undone, when the crew
// changes, at start (the schedule was just configured) and with each minute's upkeep.
const points = crewPoints({
  stores, settings: ruleBook.settings, live, now,
  onError: (err, astronautId) => app.log.error({ err, astronautId }, "points update failed"),
});
// Logged through the app's logger once it exists; relay errors can only happen after start.
const relaySystem = createRelaySystem({
  stores, live, now, snapshotIntervalMs: STATUS_EVALUATION_INTERVAL_MS, exerciseSettings: ruleBook.settings,
  pointsChanges: points,
  onError: (err) => app.log.error({ err }, "relay delivery failed"),
});
const { relay, statusListener, crew, dailyLogChanges } = relaySystem;
// Every evaluation (the minute check, status requests, the demo storm) runs one at a time through it.
const statusEvaluator = createStatusEvaluator({ stores, ruleBook, now, listener: statusListener });
// Sleep from the watch's wrist angles: at start, every hour, and when the sleep-day time zone
// changes; each run re-derives the recent ended noon-to-noon days, so late uploads still count.
const sleepDerivation = createSleepDerivationJob({
  stores,
  now,
  onAstronautFailed: (astronautId, err) => app.log.error({ err, astronautId }, "sleep derivation failed"),
  onError: (err) => app.log.error({ err }, "sleep derivation run failed"),
});

const app = await buildApp({
  stores,
  token: config.token,
  solarEvent: solarEventProfile(bundle.radiationHours),
  ruleBook,
  now,
  relay,
  statusEvaluator,
  live,
  crew,
  dailyLogChanges,
  points,
  sleepDerivation,
});
app.log.info({ loaded }, "bundled data loaded");
app.log.info({ scheduledTasks }, "schedule configured");
// Evaluate every astronaut's status regularly, so the alert log records changes even when no
// client is asking.
const statusLogJob = repeatEvery(STATUS_EVALUATION_INTERVAL_MS, async () => {
  const failures = await statusEvaluator.evaluateCrew();
  for (const { astronautId, error } of failures) app.log.error({ err: error, astronautId }, "status evaluation failed");
  await relaySystem.upkeep();
  await points.crewChanged();
}, (err) => app.log.error({ err }, "status evaluation tick failed"));
// Events that arrived while the server was down are handed over now, then each on time.
await relaySystem.start();
await sleepDerivation.start();
await points.crewChanged();
shutdownInOrder(app, { statusLogJob, sleepJob: sleepDerivation, relaySystem, points, live, pool });

await app.listen({ port: config.port, host: config.host });
