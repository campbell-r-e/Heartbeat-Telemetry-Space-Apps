/**
 * Downloads ISS cabin telemetry from NASA OSDR's Environmental Data App (EDA) API and
 * saves hourly averages to server/data/cabin-iss.json. Run with: npm run fetch:eda -w server
 *
 * Source: https://visualization.osdr.nasa.gov/eda/api/ (API reference on the EDA "API" tab)
 * Mission: RR-9 (Rodent Research 9, SpaceX-12), ISS cabin readings every 5 minutes.
 */
import { hourKey, sortedByHour, writeDataFile } from "./lib.ts";

const MISSION = "RR-9";
const url = `https://visualization.osdr.nasa.gov/eda/api/missions/${MISSION}/telemetry_data/`;
const OUT_FILE = "cabin-iss.json";

/** ppm → mmHg at a sea-level cabin (ISS runs at 14.7 psia ≈ 760 mmHg). */
const ppmToMmHg = (ppm: number) => (ppm * 760) / 1_000_000;

interface Row {
  time: string;
  temperature_iss: number | null;
  humidity_iss: number | null;
  co2_iss: number | null;
  milestones: string | null;
}

const res = await fetch(url, { headers: { Accept: "application/json" } });
if (!res.ok) throw new Error(`EDA request failed: HTTP ${res.status}`);
const rows = parseRows(await res.json());

/** Checks the response is the array of rows this script expects, naming the first bad row. */
function parseRows(json: unknown): Row[] {
  if (!Array.isArray(json)) throw new Error("EDA response is not an array of rows");
  const isReading = (v: unknown) => v === null || typeof v === "number";
  json.forEach((r, i) => {
    const ok = typeof r?.time === "string" && isReading(r.temperature_iss) && isReading(r.humidity_iss) &&
      isReading(r.co2_iss) && (r.milestones === null || typeof r.milestones === "string");
    if (!ok) throw new Error(`EDA row ${i} does not have the expected fields: ${JSON.stringify(r)}`);
  });
  return json as Row[];
}

type Acc = { temp: number[]; rh: number[]; co2: number[] };
const buckets = new Map<string, Acc>();
for (const r of rows) {
  const hour = hourKey(r.time);
  const b = buckets.get(hour) ?? { temp: [], rh: [], co2: [] };
  if (r.temperature_iss != null) b.temp.push(r.temperature_iss);
  if (r.humidity_iss != null) b.rh.push(r.humidity_iss);
  if (r.co2_iss != null) b.co2.push(r.co2_iss);
  buckets.set(hour, b);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null, d: number) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

const hourly = sortedByHour(buckets)
  .map(([t, b]) => {
    const co2ppm = mean(b.co2);
    return {
      t,
      tempC: round(mean(b.temp), 2),
      rhPct: round(mean(b.rh), 1),
      co2ppm: round(co2ppm, 0),
      co2mmHg: round(co2ppm == null ? null : ppmToMmHg(co2ppm), 3),
    };
  });

const milestones = rows.filter((r) => r.milestones).map((r) => ({ t: r.time, name: r.milestones }));

const output = {
  source: "NASA OSDR Environmental Data App (EDA) API",
  sourceUrl: url,
  mission: MISSION,
  units: {
    tempC: "°C (ISS cabin, hourly mean)",
    rhPct: "% relative humidity (hourly mean)",
    co2ppm: "ppm (as reported by EDA; unit inferred from values)",
    co2mmHg: "mmHg, converted from ppm assuming 760 mmHg cabin pressure",
  },
  retrievedAt: new Date().toISOString(),
  rawRows: rows.length,
  notes:
    "EDA timestamps for RR-9 run 2018-08-14 to 2018-09-18, although SpaceX-12 launched in August 2017. " +
    "The app replays this data on its own mission clock, so absolute dates are not used.",
  milestones,
  hourly,
};

await writeDataFile(OUT_FILE, JSON.stringify(output, null, 1), `Saved ${hourly.length} hourly points from ${rows.length} raw rows`);
