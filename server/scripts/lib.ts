// Scaffolding shared by the data scripts: where the bundled files live and how they are written.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA_DIR } from "../src/data/bundled-files.ts";

/**
 * Path of a bundled data file in server/data/, or in DATA_OUT_DIR when that is set (to try a
 * script without overwriting the bundled data).
 */
export function dataFile(name: string): string {
  return join(process.env.DATA_OUT_DIR ?? DATA_DIR, name);
}

/** The start of the UTC hour of an ISO time, e.g. "2017-09-11T05:00:00Z". */
export function hourKey(isoTime: string): string {
  return isoTime.slice(0, 13) + ":00:00Z";
}

/** Map entries keyed by hourKey, in time order. */
export function sortedByHour<T>(buckets: Map<string, T>): Array<[string, T]> {
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Writes `json` (plus a final newline) to dataFile(name) and logs `<summary> to <path>`. */
export async function writeDataFile(name: string, json: string, summary: string): Promise<void> {
  const outFile = dataFile(name);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, json + "\n");
  console.log(`${summary} to ${outFile}`);
}
