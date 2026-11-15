// The demo's labeled simulated deep-space solar storm (SPEC §5.7, §13). Re-exported from index.ts.

/**
 * The two presses of the surgeon console's storm control (owner decision): the first brings
 * Radiation to 🟡 (demo step 3), the second escalates it to 🔴 (step 6). Each value is the
 * `factor` of `POST /api/demo/solar-storm`. They were picked from the rules' own radiation
 * thresholds (🟡 ≥ 1.25×, 🔴 ≥ 1.5× the previous 7-day average): on the bundled ISS record,
 * at every hour of the mission clock's loop, factor 1.3 gives 1.28–1.47× (🟡) and factor 5, the
 * endpoint's default, gives 2.9–3.2× (🔴). A server test checks this against the settings.
 */
export const DEMO_STORM_STEPS = { watch: 1.3, alert: 5 } as const;

export type DemoStormStep = keyof typeof DEMO_STORM_STEPS;

/** GET /api/demo/solar-storm: whether the simulated storm is in the ship's data, and its factor. */
export interface SolarStormState {
  /** True while a storm is on: its readings are stored and it was pressed less than 48 hours ago. */
  active: boolean;
  /** The factor the stored storm was made with (to 2 decimals); null when none is active. */
  factor: number | null;
  /**
   * ISO time the latest storm started (its first press; escalating keeps it). Kept after the storm is
   * cleared, so the demo reset can tell that storm's alerts from older ones; null before the first storm
   * and once the reset has handled them (DELETE /api/demo/solar-storm/started-at).
   */
  startedAt: string | null;
}

/** POST /api/demo/solar-storm body. */
export interface SolarStormPress {
  /** 1–50; 5 when left out. */
  factor?: number;
  /**
   * The storm's factor the sender last saw (null: no storm). When given and the storm has changed
   * since, the press is refused with 409 and `SolarStormConflict`, so a stale console never skips a step.
   */
  expectedFactor?: number | null;
}

/** POST /api/demo/solar-storm answer: the storm now stored. */
export interface SolarStormStarted {
  simulated: true;
  factor: number;
  /** How many simulated hours were stored (the 48 event hours). */
  hours: number;
  /** The real record's mean dose rate in the 7 days before the 2017 event, which the rise is measured from. */
  baselineUGyPerHour: number;
}

/** DELETE /api/demo/solar-storm answer. */
export interface SolarStormCleared {
  cleared: true;
  /** ISO time on board when the storm was cleared: no storm alert is sent after it. */
  clearedAt: string;
}

/** 409 answer to a press whose `expectedFactor` is out of date. */
export interface SolarStormConflict {
  error: "storm_changed";
  message: string;
  current: SolarStormState;
}
