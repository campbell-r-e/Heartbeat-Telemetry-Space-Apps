// Nutrition display and the meal picker's menu handling (SPEC §5.5, §9.1). Today's and
// yesterday's totals, targets and ratings come from the server's status (derived.nutritionToday /
// nutritionYesterday); the web only totals meals per day for the calorie history chart.

import { NUTRIENTS, type Food, type FoodSource, type MealLog, type Nutrient, type NutrientRange, type NutrientTotal, type NutritionCheck, type NutritionDayStatus, type SeriesRange } from "@heartbeat/shared";
import { dailyChartData, type ChartData, type ChartPoint } from "./chart";
import { PERCENT } from "./format";
import { startOfUtcDay } from "./time";

export interface NutrientDisplay {
  key: Nutrient;
  label: string;
  unit: string;
  decimals: number;
  /** The server's rating check for this nutrient (yesterday's status). */
  check: NutritionCheck;
  /** Which bound of the target band the bar fills toward: a goal's minimum, or a limit's maximum. */
  fillToward: "min" | "max";
}

const DISPLAY: Record<Nutrient, NutrientDisplay> = {
  kcal: { key: "kcal", label: "Calories", unit: "kcal", decimals: 0, check: "energy", fillToward: "min" },
  proteinG: { key: "proteinG", label: "Protein", unit: "g", decimals: 0, check: "protein", fillToward: "min" },
  calciumMg: { key: "calciumMg", label: "Calcium", unit: "mg", decimals: 0, check: "calcium", fillToward: "min" },
  vitaminDUg: { key: "vitaminDUg", label: "Vitamin D", unit: "µg", decimals: 1, check: "vitaminD", fillToward: "min" },
  sodiumMg: { key: "sodiumMg", label: "Sodium (limit)", unit: "mg", decimals: 0, check: "sodium", fillToward: "max" },
};

/** How a nutrient is shown, looked up by key. */
export function nutrientDisplay(key: Nutrient): NutrientDisplay {
  return DISPLAY[key];
}

/** Every nutrient's display, in the shared NUTRIENTS order (complete by construction). */
export const NUTRIENT_DISPLAY: readonly NutrientDisplay[] = NUTRIENTS.map(nutrientDisplay);

function nutrientValue(food: Food, key: Nutrient): number | null {
  return food[key];
}

export interface TargetBar {
  /** How full the bar is, 0–100. */
  percent: number;
  /** Where the band's other bound sits on the bar (sodium's minimum on its limit bar), or null. */
  tickPercent: number | null;
}

const clampPercent = (value: number) => Math.min(PERCENT, Math.max(0, value));

/**
 * The bar for a total against the server's target band. A goal fills toward the band's minimum;
 * a limit (sodium) fills toward its maximum, with the minimum marked as a tick. Null when the
 * server gives no bound to fill toward.
 */
export function targetBar(total: number, range: NutrientRange, fillToward: NutrientDisplay["fillToward"]): TargetBar | null {
  const end = fillToward === "max" ? range.max : (range.min ?? range.max);
  if (end === null || end <= 0) return null;
  const tickPercent = fillToward === "max" && range.min !== null ? clampPercent((range.min / end) * PERCENT) : null;
  return { percent: clampPercent((total / end) * PERCENT), tickPercent };
}

/** True when the server rated at least one of the day's nutrition checks. */
export function isRated(day: NutritionDayStatus): boolean {
  return Object.values(day.statuses).some((status) => status !== null);
}

/** Meals totaled the way the server totals a day: known values summed, unknown ones counted. */
export function sumNutrients(meals: readonly MealLog[], foodsById: ReadonlyMap<string, Food>): Record<Nutrient, NutrientTotal> {
  const totals = Object.fromEntries(NUTRIENT_DISPLAY.map(({ key }) => [key, { atLeast: 0, unknownMeals: 0 }])) as Record<Nutrient, NutrientTotal>;
  for (const meal of meals) {
    const food = foodsById.get(meal.foodId);
    for (const { key } of NUTRIENT_DISPLAY) {
      const value = food ? nutrientValue(food, key) : null;
      if (value === null) totals[key].unknownMeals += 1;
      else totals[key].atLeast += value;
    }
  }
  return totals;
}

export interface DailyCalories {
  points: ChartPoint[];
  /** Days whose total is a lower bound because some meals have no published calorie value. */
  partialDays: number;
}

/** Calories logged per UTC day (one point at the start of each day with meals). */
export function dailyCalories(meals: readonly MealLog[], foodsById: ReadonlyMap<string, Food>): DailyCalories {
  const byDay = new Map<number, MealLog[]>();
  for (const meal of meals) {
    const day = startOfUtcDay(Date.parse(meal.eatenAt));
    byDay.set(day, [...(byDay.get(day) ?? []), meal]);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a - b).map(([tMs, dayMeals]) => ({ tMs, kcal: sumNutrients(dayMeals, foodsById).kcal }));
  return {
    points: days.map(({ tMs, kcal }) => ({ tMs, value: kcal.atLeast, simulated: false })),
    partialDays: days.filter(({ kcal }) => kcal.unknownMeals > 0).length,
  };
}

/** The Nutrition chart: calories per UTC day, with a note when some days are lower bounds. */
export function calorieChartData(meals: readonly MealLog[], foodsById: ReadonlyMap<string, Food>, range: SeriesRange, nowMs: number): ChartData {
  const { points, partialDays } = dailyCalories(meals, foodsById);
  return dailyChartData(points, { unit: "kcal", range, nowMs, note: partialDaysNote(partialDays) });
}

/** The note under a calorie chart when some days' totals are lower bounds. */
export function partialDaysNote(partialDays: number): string | undefined {
  return partialDays > 0 ? `${partialDays} day(s) include items with no published calorie value, so their totals are lower bounds.` : undefined;
}

export const ALL_CATEGORIES = "All";

/** "All" plus each menu category in the order it first appears. */
export function menuCategories(foods: readonly Food[]): string[] {
  return [ALL_CATEGORIES, ...new Set(foods.map((food) => food.category))];
}

export function filterFoods(foods: readonly Food[], filter: { query: string; category: string }): Food[] {
  const query = filter.query.trim().toLowerCase();
  return foods.filter(
    (food) =>
      (filter.category === ALL_CATEGORIES || food.category === filter.category) &&
      (query === "" || food.name.toLowerCase().includes(query)),
  );
}

/** Labels for the `sourceByField` keys of a menu item. */
const SOURCE_FIELD_LABEL: Readonly<Record<string, string>> = {
  kcal: "Calories",
  proteinG: "Protein",
  calciumMg: "Calcium",
  vitaminDUg: "Vitamin D",
  sodiumMg: "Sodium",
  serving: "Serving",
  foodType: "Food type",
};

export interface FieldSource {
  field: string;
  title: string;
  url: string | null;
}

/** Where each of a food's values comes from, as named in the menu's own source list. */
export function foodFieldSources(food: Food, sources: readonly FoodSource[]): FieldSource[] {
  return Object.entries(food.sourceByField ?? {}).map(([field, sourceId]) => {
    const source = sources.find((candidate) => candidate.id === sourceId);
    return { field: SOURCE_FIELD_LABEL[field] ?? field, title: source?.title ?? sourceId, url: source?.url ?? null };
  });
}

export function indexFoods(foods: readonly Food[]): Map<string, Food> {
  return new Map(foods.map((food) => [food.id, food]));
}
