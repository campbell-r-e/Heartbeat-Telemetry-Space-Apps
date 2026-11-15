// Live HRV (SPEC §5.1, §5.7): after the watch posts raw beat-to-beat intervals (ibi), the server
// recomputes RMSSD for every 5-minute window the new beats fall in, with the one domain/hrv.ts
// method, and stores the result as the hrv metric under the same source.
import type { Reading, ReadingSource } from "@heartbeat/shared";
import { HRV_WINDOW_MINUTES, hrvWindows, liveBatchSamples, liveBatchWindows, windowKey } from "./hrv.ts";
import { METRIC_UNITS } from "./metrics.ts";
import type { ReadingStore, StoredReading } from "./ports.ts";
import { MINUTE_MS } from "./time.ts";

const WINDOW_MS = HRV_WINDOW_MINUTES * MINUTE_MS;

interface TouchedWindows {
  astronautId: string;
  source: ReadingSource;
  windows: Set<string>;
}

/** Recomputes hrv for the windows touched by `posted`; returns the hrv readings written. */
export async function deriveHrvFromIbi(readings: ReadingStore, posted: readonly Reading[]): Promise<StoredReading[]> {
  const derived: StoredReading[] = [];
  for (const { astronautId, source, windows } of touchedWindows(posted)) {
    for (const window of windows) {
      const hrv = await windowHrv(readings, astronautId, source, window);
      if (hrv !== null) derived.push({ astronautId, metric: "hrv", value: hrv, unit: METRIC_UNITS.hrv, takenAt: window, source });
    }
  }
  await readings.upsert(derived);
  return derived;
}

function touchedWindows(posted: readonly Reading[]): TouchedWindows[] {
  const groups = new Map<string, TouchedWindows>();
  for (const reading of posted) {
    if (reading.metric !== "ibi" || !Array.isArray(reading.value)) continue;
    const key = JSON.stringify([reading.astronautId, reading.source]);
    const group = groups.get(key) ?? { astronautId: reading.astronautId, source: reading.source, windows: new Set<string>() };
    for (const window of liveBatchWindows(reading.takenAt, reading.value)) group.windows.add(window);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** RMSSD over every stored beat in the window, from any batch that reaches into it; null if too few. */
async function windowHrv(readings: ReadingStore, astronautId: string, source: ReadingSource, window: string): Promise<number | null> {
  const startMs = Date.parse(window);
  const batches = await readings.arrayReadingsOverlapping(astronautId, "ibi", source, startMs, startMs + WINDOW_MS);
  const samples = batches
    .flatMap((batch) => liveBatchSamples(batch.takenAt, batch.values))
    .filter((sample) => windowKey(sample.t) === window)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return hrvWindows(samples)[0]?.rmssdMs ?? null;
}
