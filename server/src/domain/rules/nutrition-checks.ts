// The five daily nutrition checks (SPEC §6.7): the one table of which fact each check rates and
// which settings bound its bands. The rule catalog generates its rules from it, and the daily
// targets clients show are its green bands.
import type { NutritionCheck } from "@heartbeat/shared";
import type { NumberFactId } from "./facts.ts";
import type { SettingKey } from "./settings.ts";

export interface NutritionCheckSpec {
  check: NutritionCheck;
  fact: NumberFactId;
  /** 🔴 below. */
  alertBelow: SettingKey;
  /** 🟡 below; the green band's lower edge. */
  watchBelow: SettingKey;
  /** 🟡 above; the green band's upper edge. */
  watchAbove: SettingKey;
  /** 🔴 above; null where NASA gives no red band above (vitamin D). */
  alertAbove: SettingKey | null;
  /** True when 🔴 starts at alertAbove itself (energy: "at or above 120%"); otherwise only above it. */
  alertAboveIncludesEdge: boolean;
  /** Further facts whose rules also rate this check; the worse status wins (protein's Req. 2 minimum). */
  alsoRatedBy: readonly NumberFactId[];
}

export const NUTRITION_CHECK_SPECS: Readonly<Record<NutritionCheck, NutritionCheckSpec>> = {
  energy: {
    check: "energy", fact: "energyDayPctOfEer",
    alertBelow: "nutrition.energyAlertBelowPct", watchBelow: "nutrition.energyWatchBelowPct",
    watchAbove: "nutrition.energyWatchAbovePct", alertAbove: "nutrition.energyAlertFromPct", alertAboveIncludesEdge: true, alsoRatedBy: [],
  },
  protein: {
    check: "protein", fact: "proteinDayPctOfKcal",
    alertBelow: "nutrition.proteinAlertBelowPctKcal", watchBelow: "nutrition.proteinWatchBelowPctKcal",
    watchAbove: "nutrition.proteinWatchAbovePctKcal", alertAbove: "nutrition.proteinAlertAbovePctKcal", alertAboveIncludesEdge: false,
    alsoRatedBy: ["proteinDayGPerKg"],
  },
  calcium: {
    check: "calcium", fact: "calciumDayMg",
    alertBelow: "nutrition.calciumAlertBelowMg", watchBelow: "nutrition.calciumWatchBelowMg",
    watchAbove: "nutrition.calciumWatchAboveMg", alertAbove: "nutrition.calciumAlertAboveMg", alertAboveIncludesEdge: false, alsoRatedBy: [],
  },
  vitaminD: {
    check: "vitaminD", fact: "vitaminDDayUg",
    alertBelow: "nutrition.vitaminDAlertBelowUg", watchBelow: "nutrition.vitaminDWatchBelowUg",
    watchAbove: "nutrition.vitaminDWatchAboveUg", alertAbove: null, alertAboveIncludesEdge: false, alsoRatedBy: [],
  },
  sodium: {
    check: "sodium", fact: "sodiumDayMg",
    alertBelow: "nutrition.sodiumAlertBelowMg", watchBelow: "nutrition.sodiumWatchBelowMg",
    watchAbove: "nutrition.sodiumWatchAboveMg", alertAbove: "nutrition.sodiumAlertAboveMg", alertAboveIncludesEdge: false, alsoRatedBy: [],
  },
};
