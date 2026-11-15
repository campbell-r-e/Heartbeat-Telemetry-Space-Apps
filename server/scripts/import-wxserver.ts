/**
 * Imports Galaxy Watch history from the watch-telemetry-server on wxserver and saves it to
 * server/data/astronaut1-history.json for Astronaut 1. Run with: npm run import:wxserver -w server
 *
 * Reads over SSH (host alias "wxserver") with psql inside the telemetry-db-1 container, read-only.
 * Location data is deliberately NOT imported.
 *
 *   heart rate  → per-minute mean bpm (hr_status = 1 only)
 *   HRV         → RMSSD per 5 minutes from beat-to-beat intervals (ibi_status = 0 only)
 *   skin temp   → per-reading °C (status = 0, not settling)
 *
 * Steps are not imported: astronauts don't walk in microgravity, so there is no steps metric.
 */
import { execFileSync } from "node:child_process";
import { hrvWindows } from "../src/domain/hrv.ts";
import { writeDataFile } from "./lib.ts";

const SSH_HOST = process.env.WX_HOST ?? "wxserver";
const OUT_FILE = "astronaut1-history.json";

/** Runs a read-only query on wxserver and returns CSV rows (without the header). */
function query(sql: string): string[][] {
  const copy = `COPY (${sql}) TO STDOUT WITH CSV`;
  const out = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", SSH_HOST, "docker", "exec", "-i", "telemetry-db-1", "psql", "-U", "telemetry", "-d", "telemetry", "-At", "-v", "ON_ERROR_STOP=1"],
    { input: `BEGIN READ ONLY; ${copy}; COMMIT;`, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((l) => l && l !== "BEGIN" && l !== "COMMIT")
    .map(parseCsvLine);
}

/** Minimal CSV parser for psql output (handles quoted fields such as "{1,2,3}"). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const pgArray = (s: string): number[] => (s && s !== "{}" ? s.replace(/[{}]/g, "").split(",").map(Number) : []);
const iso = (pgTime: string) => new Date(pgTime.replace(" ", "T").replace(/\+00$/, "Z")).toISOString();

// Heart rate: per-minute mean of valid readings.
const heartRate = query(`
  SELECT date_trunc('minute', t) AS m, round(avg(bpm)::numeric, 1), count(*)
  FROM heart_rate WHERE hr_status = 1 AND bpm > 0
  GROUP BY 1 ORDER BY 1`).map(([t, bpm, n]) => ({ t: iso(t), bpm: Number(bpm), n: Number(n) }));

// HRV: RMSSD per 5-minute window (SPEC.md §5.7), computed in domain/hrv.ts.
const ibiRows = query(`
  SELECT t, ibi_ms, ibi_status FROM heart_rate
  WHERE ibi_ms IS NOT NULL AND cardinality(ibi_ms) > 0 ORDER BY t`);
const hrv = hrvWindows(ibiRows.map(([t, ibis, statuses]) => ({ t: iso(t), ibisMs: pgArray(ibis), statuses: pgArray(statuses) })));

// Skin temperature: valid, settled readings.
const skinTemp = query(`
  SELECT t, skin_c FROM skin_temp
  WHERE status = 0 AND NOT settling AND skin_c IS NOT NULL ORDER BY t`).map(([t, c]) => ({ t: iso(t), skinC: Math.round(Number(c) * 100) / 100 }));

const output = {
  source: "watch-telemetry-server on wxserver (Galaxy Watch; location excluded)",
  retrievedAt: new Date().toISOString(),
  units: { bpm: "beats/min, per-minute mean", rmssdMs: "ms, RMSSD per 5 min", skinC: "°C" },
  span: { from: heartRate[0]?.t ?? null, to: heartRate.at(-1)?.t ?? null },
  heartRate,
  hrv,
  skinTemp,
};

await writeDataFile(
  OUT_FILE,
  JSON.stringify(output),
  `Saved ${heartRate.length} HR minutes, ${hrv.length} HRV windows, ${skinTemp.length} skin temps`,
);
