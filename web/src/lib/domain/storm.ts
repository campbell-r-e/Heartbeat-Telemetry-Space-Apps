// The surgeon console's demo control for the labeled simulated deep-space solar storm (SPEC §13,
// owner decision): two presses, the first to Radiation ▲ watch (demo step 3), the second to ■ alert
// (step 6), and a clear for resets. The factors come from @heartbeat/shared (DEMO_STORM_STEPS),
// where the server's tests check them against the rules; nothing here rates anything.

import { DEMO_STORM_STEPS, type DemoStormStep, type SolarStormState } from "@heartbeat/shared";
import type { Loaded } from "./onboard-response";

export const STORM_STEPS = Object.keys(DEMO_STORM_STEPS) as DemoStormStep[];

export interface StormControlModel {
  /** What the storm is now, in words. */
  state: string;
  /** The step the main button sends; null when there is no next step (or the state is unknown). */
  nextStep: DemoStormStep | null;
  /** The main button's text. */
  pressLabel: string;
  /** Whether "Clear storm" has anything to clear (always offered when the state is unknown). */
  canClear: boolean;
  /**
   * The storm this view shows, sent with a press so the server can refuse it (409) when the storm has
   * changed since (pending owner review): a factor, NO_STORM, or null to send no expectation (a storm
   * whose factor could not be read back).
   */
  expected: string | null;
}

/** The form value for "this view shows no storm". */
export const NO_STORM = "none";

const PRESS_LABEL: Record<DemoStormStep, string> = {
  watch: "Start storm (Radiation ▲ watch)",
  alert: "Escalate storm (Radiation ■ alert)",
};
const AT_ALERT_LABEL = "Storm at its peak (■ alert)";

/** Which step a stored factor is: the highest step it reaches (a storm started some other way still has one). */
export function stepOfFactor(factor: number): DemoStormStep | null {
  const reached = STORM_STEPS.filter((step) => factor >= DEMO_STORM_STEPS[step]);
  return reached.at(-1) ?? null;
}

/** The step after `current` (none yet = the first step); null after the last. */
export function nextStormStep(current: DemoStormStep | null): DemoStormStep | null {
  return STORM_STEPS[current === null ? 0 : STORM_STEPS.indexOf(current) + 1] ?? null;
}

export function stormControl(loaded: Loaded<SolarStormState>): StormControlModel {
  if (!loaded.ok) {
    return { state: `Storm state unavailable: ${loaded.problem}`, nextStep: null, pressLabel: PRESS_LABEL.watch, canClear: true, expected: null };
  }
  const { active, factor } = loaded.value;
  if (!active) return { state: "No simulated storm", nextStep: "watch", pressLabel: PRESS_LABEL.watch, canClear: false, expected: NO_STORM };
  const current = factor === null ? null : stepOfFactor(factor);
  const next = nextStormStep(current);
  const factorText = factor === null ? "" : ` (factor ${factor})`;
  const state = current === null ? `Simulated storm active${factorText}` : `Simulated storm, step ${STORM_STEPS.indexOf(current) + 1} of ${STORM_STEPS.length}${factorText}`;
  const expected = factor === null ? null : String(factor);
  return { state, nextStep: next, pressLabel: next === null ? AT_ALERT_LABEL : PRESS_LABEL[next], canClear: true, expected };
}

/** A form's step field, or null when it is not one of the steps. */
export function parseStormStep(value: FormDataEntryValue | null): DemoStormStep | null {
  return STORM_STEPS.find((step) => step === value) ?? null;
}

/**
 * A form's expectedFactor field as the server takes it: a factor, null for NO_STORM, or undefined
 * when the form sent none; "invalid" for anything else.
 */
export function parseExpectedFactor(value: FormDataEntryValue | null): number | null | undefined | "invalid" {
  if (value === null) return undefined;
  if (value === NO_STORM) return null;
  const factor = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(factor) ? factor : "invalid";
}
