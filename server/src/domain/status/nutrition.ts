// Daily nutrition from logged meals × the menu's values (SPEC §5.5), and the daily targets from
// NASA's nutrition requirements for exploration missions (2005). A food with no value for a
// nutrient is counted as unknown, never as 0, so totals are "at least" values.
import {
  NUTRIENTS, type Astronaut, type Food, type MealLog, type Nutrient, type NutrientRange, type NutrientTotal, type NutritionCheck,
  type NutritionDay, type NutritionTargets,
} from "@heartbeat/shared";
import { NUTRITION_CHECK_SPECS } from "../rules/nutrition-checks.ts";
import { EER_EQUATIONS, type RuleSettings } from "../rules/settings.ts";
import { DAY_MS, utcDayLabel } from "../time.ts";

/** The profile fields the nutrition targets use. */
export type AstronautProfile = Pick<Astronaut, "age" | "sex" | "massKg" | "heightM">;

/** The EER equations apply from age 19 (Req. 1). */
const MIN_EER_AGE_YEARS = 19;
const PERCENT = 100;

/** Totals of the meals eaten in the UTC day starting at `dayStartMs`. */
export function nutritionDay(meals: readonly MealLog[], foods: readonly Food[], dayStartMs: number, complete: boolean): NutritionDay {
  const foodById = new Map(foods.map((food) => [food.id, food]));
  const eaten = meals
    .filter((meal) => { const t = Date.parse(meal.eatenAt); return t >= dayStartMs && t < dayStartMs + DAY_MS; })
    .map((meal) => foodById.get(meal.foodId));
  const total = (nutrient: Nutrient): NutrientTotal => {
    const values = eaten.map((food) => food?.[nutrient] ?? null);
    return {
      atLeast: values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      unknownMeals: values.filter((value) => value === null).length,
    };
  };
  const totals = Object.fromEntries(NUTRIENTS.map((nutrient) => [nutrient, total(nutrient)])) as Record<Nutrient, NutrientTotal>;
  return { day: utcDayLabel(dayStartMs), complete, mealsLogged: eaten.length, totals };
}

/** The day's total of a nutrient when every logged meal has a value for it; null otherwise or with no meals. */
export function knownTotal(day: NutritionDay, nutrient: Nutrient): number | null {
  const { atLeast, unknownMeals } = day.totals[nutrient];
  return day.mealsLogged > 0 && unknownMeals === 0 ? atLeast : null;
}

/** Estimated energy requirement in kcal/day (Req. 1); null until age (19+), sex, mass and height are known. */
export function estimatedEnergyRequirement(profile: AstronautProfile): number | null {
  const { age, sex, massKg, heightM } = profile;
  if (age === null || sex === null || massKg === null || heightM === null || age < MIN_EER_AGE_YEARS) return null;
  const eq = EER_EQUATIONS[sex];
  return eq.base - eq.perYear * age + eq.activityFactor * (eq.perKg * massKg + eq.perM * heightM);
}

/** The green band of each nutrient, from the settings and the astronaut's EER and mass. */
export function nutritionTargets(profile: AstronautProfile, settings: RuleSettings): NutritionTargets {
  const eerKcal = estimatedEnergyRequirement(profile);
  const ofEer = (pct: number | null) => (eerKcal === null || pct === null ? null : (eerKcal * pct) / PERCENT);
  const perKg = settings["nutrition.proteinGPerKg"];
  const greenBand = (check: NutritionCheck): NutrientRange => {
    const spec = NUTRITION_CHECK_SPECS[check];
    return { min: settings[spec.watchBelow], max: settings[spec.watchAbove] };
  };
  const energy = greenBand("energy");
  return {
    kcal: { min: ofEer(energy.min), max: ofEer(energy.max) },
    proteinG: { min: profile.massKg === null || perKg === null ? null : perKg * profile.massKg, max: null },
    proteinPctOfKcal: greenBand("protein"),
    calciumMg: greenBand("calcium"),
    vitaminDUg: greenBand("vitaminD"),
    sodiumMg: greenBand("sodium"),
    eerKcal,
  };
}

/** Share of the day's calories that came from protein, in percent. */
export function proteinPercentOfKcal(proteinG: number, kcal: number, kcalPerG: number): number {
  return (proteinG * kcalPerG * PERCENT) / kcal;
}
