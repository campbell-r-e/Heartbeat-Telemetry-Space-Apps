// The pure decisions behind the one-command demo reset (scripts/demo-reset.ts, SPEC §13): where the
// running server is, which token it takes, how long alerts still on the way take, which surgeon
// alerts are the rehearsal's, and whether the web app's environment and the watch build are set up.
// No I/O here.
import type { DelayPreset, GroundAlert } from "@heartbeat/shared";
import { RULES } from "../src/domain/rules/catalog.ts";

/** The demo's link preset and scaling (owner decision: Mars far, 30 s one way, demo scaling). */
export const DEMO_RELAY_SETTING: { preset: DelayPreset; realTime: false } = { preset: "marsFar", realTime: false };

export const DEFAULT_SERVER_URL = "http://localhost:4000";

/** The rules the simulated storm sets off: every rule that reads the ship's daily-dose multiple. */
export const STORM_RULE_IDS: ReadonlySet<string> = new Set(
  RULES.filter((rule) => rule.when.some((condition) => condition.fact === "radiationDailyDoseMultiple")).map((rule) => rule.id),
);

/** KEY=VALUE lines of a .env file; blank lines and # comments are skipped, and one pair of quotes is removed. */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    // A comment line starts with "#", which no key can, so it never matches.
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

export interface ResetTarget {
  serverUrl: string;
  token: string;
}

/**
 * The server to reset and its write token: the environment wins, then the repo root's .env (the
 * file docker compose reads). Throws with what to set when there is no token.
 */
export function resetTarget(env: Readonly<Record<string, string | undefined>>, rootDotEnv: string | null): ResetTarget {
  const fromFile = rootDotEnv === null ? {} : parseDotEnv(rootDotEnv);
  const token = env.HEARTBEAT_TOKEN || fromFile.HEARTBEAT_TOKEN;
  if (!token) throw new Error("HEARTBEAT_TOKEN is not set: put it in the repo root's .env (see .env.example) or the environment.");
  return { serverUrl: env.HEARTBEAT_SERVER_URL || DEFAULT_SERVER_URL, token };
}

// The running server is a Docker image that may be older than this checkout, so every answer the
// reset acts on is checked first.
const SHAPE_ERROR = (what: string) => new Error(`The server's ${what} has an unexpected shape; rebuild it with \`docker compose up -d --build\`.`);
const fieldOf = (body: unknown, key: string): unknown => (typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined);

/** The fields of an alert the reset reads, on the ground (with its state) or on board (without). */
export type AlertToCheck = Pick<GroundAlert, "alertId" | "ruleId" | "state" | "sentAt">;
export type SentAlert = Pick<GroundAlert, "alertId" | "ruleId" | "sentAt">;

const ALERT_STATES: readonly unknown[] = ["new", "acknowledged", "resolved"] satisfies GroundAlert["state"][];
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

const isSentAlert = (value: unknown): value is SentAlert =>
  typeof fieldOf(value, "alertId") === "string" && typeof fieldOf(value, "ruleId") === "string" && isTime(fieldOf(value, "sentAt"));

const isAlertToCheck = (value: unknown): value is AlertToCheck => isSentAlert(value) && ALERT_STATES.includes(fieldOf(value, "state"));

/** GET /api/ground/alerts as the reset needs it, checked before any alert is resolved. */
export function parseGroundAlerts(body: unknown): AlertToCheck[] {
  if (Array.isArray(body) && body.every(isAlertToCheck)) return body;
  throw SHAPE_ERROR("alert list");
}

/** GET /api/astronauts/:id/relayed-alerts: the alerts that left the ship, arrived or not. */
export function parseSentAlerts(body: unknown): SentAlert[] {
  if (Array.isArray(body) && body.every(isSentAlert)) return body;
  throw SHAPE_ERROR("relayed alert list");
}

/** The crew's ids from GET /api/astronauts. */
export function parseCrewIds(body: unknown): string[] {
  const ids = Array.isArray(body) ? body.map((member) => fieldOf(member, "id")) : null;
  if (ids?.every((id): id is string => typeof id === "string")) return ids;
  throw SHAPE_ERROR("crew list");
}

/** `clearedAt` of DELETE /api/demo/solar-storm. */
export function parseClearedAt(body: unknown): string {
  const clearedAt = fieldOf(body, "clearedAt");
  if (isTime(clearedAt)) return clearedAt;
  throw SHAPE_ERROR("storm clear");
}

/** When the rehearsal's storm alerts were sent: from the storm's start to its clear, both included. */
export interface StormWindow {
  fromMs: number;
  toMs: number;
}

/** The storm's window, or null when no storm start is recorded (none since the last reset). */
export function stormWindow(startedAt: string | null, clearedAt: string): StormWindow | null {
  return startedAt === null ? null : { fromMs: Date.parse(startedAt), toMs: Date.parse(clearedAt) };
}

const isStormAlertIn = (alert: SentAlert, window: StormWindow) => {
  const sentMs = Date.parse(alert.sentAt);
  return STORM_RULE_IDS.has(alert.ruleId) && sentMs >= window.fromMs && sentMs <= window.toMs;
};

/**
 * The rehearsal's alerts to resolve: open alerts (new or acknowledged) from the storm's rules sent
 * while the latest storm was on, from its start to its clear (pending owner review). Nothing is sent
 * after the clear, and the real looped ISS record fires the same rules (SPEC §5.7), so a storm-rule
 * alert outside that window may come from real data and is left for the flight surgeon, as is every
 * alert from another rule. No recorded start (the last reset forgot it), no rehearsal.
 */
export function rehearsalAlerts<A extends AlertToCheck>(alerts: readonly A[], window: StormWindow | null): A[] {
  if (window === null) return [];
  return alerts.filter((alert) => alert.state !== "resolved" && isStormAlertIn(alert, window));
}

/**
 * The rehearsal's storm alerts that left the ship but have not reached the ground yet (their arrival
 * may be being retried, SPEC §8): sent in the window and missing from the ground's feed.
 */
export function alertsStillInFlight(sent: readonly SentAlert[], onGround: readonly AlertToCheck[], window: StormWindow | null): SentAlert[] {
  if (window === null) return [];
  const arrived = new Set(onGround.map((alert) => alert.alertId));
  const seen = new Set<string>();
  return sent.filter((alert) => {
    if (seen.has(alert.alertId)) return false; // a crew-wide alert shows on every astronaut's list
    seen.add(alert.alertId);
    return isStormAlertIn(alert, window) && !arrived.has(alert.alertId);
  });
}

/** `oneWayDelayMs` of GET or PUT /api/relay/delay. */
export function parseOneWayDelayMs(body: unknown): number {
  const delay = fieldOf(body, "oneWayDelayMs");
  if (typeof delay === "number" && delay >= 0) return delay;
  throw SHAPE_ERROR("link delay");
}

/** `startedAt` of GET /api/demo/solar-storm: when the latest storm started, or null. */
export function parseStormStartedAt(body: unknown): string | null {
  const startedAt = fieldOf(body, "startedAt");
  if (startedAt === null || (typeof startedAt === "string" && !Number.isNaN(Date.parse(startedAt)))) return startedAt;
  throw SHAPE_ERROR("storm state");
}

/** Extra wait after one link delay, for the delivery timer and the server's own work. */
export const IN_FLIGHT_MARGIN_MS = 2_000;
/** After that, how often to look again for storm alerts whose arrival is being retried, and for how long. */
export const RETRY_POLL_MS = 5_000;
export const RETRY_WAIT_MS = 60_000;

/**
 * How long to wait after clearing the storm for its alerts still on the way to reach the ground:
 * one link delay, the longer of the setting before and after the reset (alerts keep the delay they
 * were sent with), plus a margin.
 */
export function inFlightWaitMs(delayBeforeMs: number, delayAfterMs: number): number {
  return Math.max(delayBeforeMs, delayAfterMs) + IN_FLIGHT_MARGIN_MS;
}

/**
 * What is wrong with web/.env.local for the demo, or null when it is fine: the dashboard's writes
 * (meals, check-ins, the surgeon's actions and the storm control) need the server's token.
 */
export function webEnvProblem(serverToken: string, webEnvLocal: string | null): string | null {
  if (webEnvLocal === null) return "web/.env.local is missing: run `cp web/.env.example web/.env.local` and set HEARTBEAT_TOKEN to the root .env's value.";
  const token = parseDotEnv(webEnvLocal).HEARTBEAT_TOKEN;
  if (!token) return "web/.env.local has no HEARTBEAT_TOKEN: set it to the root .env's value.";
  if (token !== serverToken) return "web/.env.local's HEARTBEAT_TOKEN differs from the server's: the web app's writes will get 401.";
  return null;
}

/**
 * What is wrong with watch/app/libs/ for a watch build, or null when the Samsung SDK .aar is there.
 * The .aar is license-restricted, so it is gitignored and copied in by hand (watch/README.md);
 * without it the watch builds without ECG and SpO₂ ("Samsung SDK not in this build").
 */
export function samsungSdkProblem(watchLibFiles: readonly string[] | null): string | null {
  if (watchLibFiles?.some((name) => name.endsWith(".aar"))) return null;
  return "watch/app/libs/ has no Samsung Health Sensor SDK .aar: a watch built from this checkout has no ECG or SpO₂. Copy it in as watch/README.md describes before `./gradlew assembleDebug`.";
}
