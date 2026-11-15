// The shape of a rule (SPEC §6.3): plain data the engine interprets. Thresholds are setting keys,
// not numbers, so every number lives in the one configuration (settings.ts).
import type { Area, Hazard, RuleLayer, RuleSource, Status, StatusMessage } from "@heartbeat/shared";
import type { FlagFactId, NumberFactId } from "./facts.ts";
import type { SettingKey } from "./settings.ts";

export type Comparison = "gt" | "gte" | "lt" | "lte";

/**
 * Compares a numeric fact with a setting, or checks a yes/no fact. `onlyWithData` makes the
 * condition apply only once its fact has data; without data it is skipped instead of stopping the rule.
 */
export type Condition =
  | { fact: NumberFactId; op: Comparison; setting: SettingKey; onlyWithData?: true }
  | { fact: FlagFactId; is: boolean; onlyWithData?: true };

export interface Rule {
  id: string;
  /** A short plain-language name for banners, the watch and the surgeon console. */
  title: string;
  area: Area;
  hazard: Hazard | null;
  layer: RuleLayer;
  /** Every condition must hold for the rule to fire. */
  when: readonly Condition[];
  /** "normal" only together with `ratesOnlyWhenFired`: a rule that marks a state as explicitly good. */
  status: Status;
  /**
   * When set, the rule rates its area only when it fires; otherwise it leaves the area unrated
   * instead of counting as 🟢 (e.g. Gravity, rated only in the evening or once the goal is met).
   */
  ratesOnlyWhenFired?: true;
  /**
   * "{factId}" placeholders are filled with the fact's value and "{setting:key}" placeholders with
   * the setting, so a message never restates a threshold as literal text.
   */
  message: StatusMessage;
  source: RuleSource;
}
