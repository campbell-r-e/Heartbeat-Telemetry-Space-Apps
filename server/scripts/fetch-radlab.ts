/**
 * Downloads ISS radiation data from NASA RadLab and saves hourly averages to
 * server/data/radiation-iss.json. Run with: npm run fetch:radlab -w server
 *
 * Source: NASA OSDR RadLab Data API (https://visualization.osdr.nasa.gov/radlab/gui/data-api)
 * Instrument: DosTel2 (DOSIS-3D, Columbus module), absorbed dose rate in µGy/hour.
 * Window: 2017-08-29 to 2017-09-30, which includes the September 2017 solar particle event.
 */
import { roundDose } from "../src/domain/solar-storm.ts";
import { hourKey, sortedByHour, writeDataFile } from "./lib.ts";

const INSTRUMENT = "DosTel2";
const START = "2017-08-29T00:00";
const END = "2017-09-30T00:00";

const url =
  "https://visualization.osdr.nasa.gov/radlab/api/?spacecraft=ISS" +
  `&instrument_id=${INSTRUMENT}` +
  `&timestamp%3E=${encodeURIComponent(START)}` +
  `&timestamp%3C${encodeURIComponent(END)}` +
  "&absorbed_dose_rate&format=csv";

const OUT_FILE = "radiation-iss.json";

const res = await fetch(url);
if (!res.ok) throw new Error(`RadLab request failed: HTTP ${res.status}`);
const csv = await res.text();

const [header, ...lines] = csv.trim().split("\n");
const cols = header.split(",");
const iTime = cols.indexOf("timestamp");
const iDose = cols.indexOf("absorbed_dose_rate");
if (iTime < 0 || iDose < 0) throw new Error(`Unexpected RadLab columns: ${header}`);

// Average raw readings (about one every 100 s) into hourly buckets.
const buckets = new Map<string, { sum: number; n: number }>();
for (const line of lines) {
  const parts = line.split(",").map((p) => p.replaceAll('"', ""));
  const dose = Number(parts[iDose]);
  if (!parts[iDose] || !Number.isFinite(dose)) continue;
  const hour = hourKey(parts[iTime]);
  const b = buckets.get(hour) ?? { sum: 0, n: 0 };
  b.sum += dose;
  b.n += 1;
  buckets.set(hour, b);
}

const hourly = sortedByHour(buckets)
  .map(([t, b]) => ({ t, uGyPerHour: roundDose(b.sum / b.n), samples: b.n }));

const output = {
  source: "NASA OSDR RadLab Data API",
  sourceUrl: url,
  spacecraft: "ISS",
  instrument: INSTRUMENT,
  unit: "µGy/hour (absorbed dose rate, hourly mean)",
  retrievedAt: new Date().toISOString(),
  rawRows: lines.length,
  notes:
    "Includes the September 2017 solar particle event (dose elevated on 2017-09-11 and 2017-09-12). " +
    "Hourly means still vary with orbit position (e.g. South Atlantic Anomaly passes); rules use daily totals.",
  hourly,
};

await writeDataFile(OUT_FILE, JSON.stringify(output, null, 1), `Saved ${hourly.length} hourly points from ${lines.length} raw rows`);
