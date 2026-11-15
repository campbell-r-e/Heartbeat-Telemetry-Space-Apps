// What counts as an exercise minute (SPEC §5.4): heart rate at or above a fraction (the
// `exercise.moderateIntensityFraction` setting) of the estimated max heart rate, 220 − age. A leaf
// module, so both the rules (their limit labels) and the status calculations can import it.
import type { RuleSettings } from "./rules/settings.ts";

/** Estimated max heart rate = this − age. */
export const MAX_HEART_RATE_AGE_BASE = 220;

/** The heart rate an exercise minute needs; null when the age or the fraction is unknown. */
export function exerciseThresholdBpm(
  age: number | null, settings: Pick<RuleSettings, "exercise.moderateIntensityFraction">,
): number | null {
  const fraction = settings["exercise.moderateIntensityFraction"];
  if (age === null || fraction === null) return null;
  return fraction * (MAX_HEART_RATE_AGE_BASE - age);
}
