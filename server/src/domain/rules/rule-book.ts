import { RULES } from "./catalog.ts";
import type { Rule } from "./rule.ts";
import { MAX_READING_AGE_MINUTES, RULE_SETTINGS, type MaxReadingAges, type RuleSettings } from "./settings.ts";

/** Everything the rules engine is configured with, handed in so tests can inject their own. */
export interface RuleBook {
  rules: readonly Rule[];
  settings: RuleSettings;
  /** When each metric's newest reading expires. */
  maxReadingAgeMinutes: MaxReadingAges;
}

/** The catalog with its configuration, as the server runs it. */
export const DEFAULT_RULE_BOOK: RuleBook = { rules: RULES, settings: RULE_SETTINGS, maxReadingAgeMinutes: MAX_READING_AGE_MINUTES };
