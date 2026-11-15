// When the real ISS record will show Radiation 🟡 or 🔴 on its own (SPEC §13): `npm run
// demo:radiation-forecast` from the repo root. The record plays from the server's start: by default
// the compose server container's start (`docker inspect`), or `--started <ISO time>`. The mission's
// start (for the career-dose rules) and the crew's profiles come from the running server
// (HEARTBEAT_SERVER_URL, default http://localhost:4000), or the defaults when it does not answer.
// `--days <n>` sets how far ahead to look (default 14). A restart moves every time listed.
import { execFileSync } from "node:child_process";
import { readRadiationHours } from "../src/data/bundled-files.ts";
import { DEFAULT_MISSION, missionStartDayMs } from "../src/domain/mission.ts";
import { RULE_SETTINGS } from "../src/domain/rules/settings.ts";
import type { AstronautProfile } from "../src/domain/status/nutrition.ts";
import { DAY_MS, HOUR_MS } from "../src/domain/time.ts";
import { DEFAULT_SERVER_URL } from "./demo-reset-plan.ts";
import { parseForecastDays, realRadiationWindows, type ForecastContext } from "./radiation-forecast-plan.ts";

const SERVER_CONTAINER = "heartbeat-telemetry-server-1";
const DEFAULT_DAYS = 14;
const REQUEST_TIMEOUT_MS = 10_000;
const SYMBOL = { watch: "▲ watch (🟡)", alert: "■ alert (🔴)" } as const;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function serverStartMs(): number {
  const given = option("started");
  const started = given ?? execFileSync("docker", ["inspect", "-f", "{{.State.StartedAt}}", SERVER_CONTAINER], { encoding: "utf8" }).trim();
  const ms = Date.parse(started);
  if (Number.isNaN(ms)) throw new Error(`Not a time: ${JSON.stringify(started)} (use --started 2026-11-15T06:02:00Z)`);
  return ms;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, process.env.HEARTBEAT_SERVER_URL || DEFAULT_SERVER_URL), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return response.json();
}

/** The mission's start and the crew's profiles from the running server, or the defaults with a note. */
async function forecastContext(): Promise<ForecastContext> {
  try {
    const mission = await getJson("/api/mission");
    const crew = await getJson("/api/astronauts");
    const startDate = typeof mission === "object" && mission !== null ? (mission as { startDate?: unknown }).startDate : undefined;
    if (typeof startDate !== "string" || !Array.isArray(crew)) throw new Error("unexpected answer shape");
    return { missionStartMs: missionStartDayMs(startDate), profiles: crew as AstronautProfile[], settings: RULE_SETTINGS };
  } catch (error) {
    console.log(`(The server did not answer, so the default mission start ${DEFAULT_MISSION.startDate} and no profiles are used: ${String(error)})`);
    return { missionStartMs: missionStartDayMs(DEFAULT_MISSION.startDate), profiles: [], settings: RULE_SETTINGS };
  }
}

const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

async function main(): Promise<void> {
  const days = parseForecastDays(option("days"), DEFAULT_DAYS);
  const startMs = serverStartMs();
  const context = await forecastContext();
  const nowMs = Date.now();
  const windows = realRadiationWindows(readRadiationHours(), startMs, nowMs, nowMs + days * DAY_MS, context);
  console.log(`Server started ${utc(startMs)}. Real-data Radiation 🟡/🔴 (daily and career dose) in the next ${days} days; avoid these for the demo:`);
  if (windows.length === 0) console.log("  none");
  for (const w of windows) {
    const from = w.inProgress ? "now (already on)" : utc(w.fromMs);
    const hoursAfterStart = Math.round((w.fromMs - startMs) / HOUR_MS);
    console.log(`  ${from} to ${utc(w.toMs)}  ${SYMBOL[w.status]}  (${hoursAfterStart} h after the server start)`);
  }
}

main().catch((error: unknown) => {
  console.error(`■ Forecast failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
