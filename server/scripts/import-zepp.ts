/**
 * Imports Astronaut 1's own Zepp OS watch history from the decoded Zepp app export and saves it
 * to server/data/astronaut1-zepp.json. Run with: npm run import:zepp -w server
 *
 * Reads heart_rate_minutely, sleep_sessions, readiness_hrv and spo2_odi_nightly from
 * ZEPP_DECODED_DIR (default ~/.local/share/zepp-tools/data/decoded). The conversion is in
 * zepp-conversion.ts (SPEC §5.7):
 *
 *   heart rate  → per-minute bpm
 *   HRV         → Zepp's nightly sleep HRV (ms), at the night's wake time
 *   sleep       → hours asleep (light + deep + REM), at the session's wake time
 *   SpO₂        → Zepp's nightly blood-oxygen score (%), at the night's wake time
 *
 * Where the bundled Galaxy Watch history has heart rate in the same minute, or HRV in the same
 * 5-minute window, the Galaxy Watch wins and the Zepp value is left out. Stress, PAI, readiness,
 * steps and skin temperature are not imported, and no device identifiers are written.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readAstronaut1History } from "../src/data/bundled-files.ts";
import { writeDataFile } from "./lib.ts";
import { convertZeppExport, parseDecodedExport, ZEPP_TIME_ZONE } from "./zepp-conversion.ts";

const DECODED_DIR = process.env.ZEPP_DECODED_DIR ?? join(homedir(), ".local", "share", "zepp-tools", "data", "decoded");
const OUT_FILE = "astronaut1-zepp.json";

const readDecoded = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(DECODED_DIR, `${name}.json`), "utf8"));

const decoded = parseDecodedExport({
  heartRate: await readDecoded("heart_rate_minutely"),
  sleepSessions: await readDecoded("sleep_sessions"),
  readiness: await readDecoded("readiness_hrv"),
  spo2Nights: await readDecoded("spo2_odi_nightly"),
});

const galaxy = readAstronaut1History();
const galaxyTimes = (points: ReadonlyArray<{ t: string }>) => points.map((p) => Date.parse(p.t));
const { history, report } = convertZeppExport(decoded, { heartRate: galaxyTimes(galaxy.heartRate), hrv: galaxyTimes(galaxy.hrv) });

const output = {
  source: "Zepp app export of a Zepp OS watch",
  device: "Zepp OS watch",
  retrievedAt: new Date().toISOString(),
  timeZone: ZEPP_TIME_ZONE,
  units: {
    bpm: "beats/min, per minute",
    sleepHrvMs: "ms, Zepp nightly sleep HRV",
    asleepH: "hours asleep (light + deep + REM)",
    scorePct: "%, Zepp nightly blood-oxygen score",
  },
  span: { from: history.heartRate[0]?.t ?? null, to: history.heartRate.at(-1)?.t ?? null },
  ...history,
};

console.log("Left out:", report);
await writeDataFile(
  OUT_FILE,
  JSON.stringify(output),
  `Saved ${history.heartRate.length} HR minutes, ${history.hrv.length} nightly HRV, ${history.sleep.length} sleep sessions, ${history.spo2.length} nightly SpO₂`,
);
