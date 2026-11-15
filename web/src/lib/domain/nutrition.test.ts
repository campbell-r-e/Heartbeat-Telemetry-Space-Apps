import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NUTRIENTS, type Food, type MealLog } from "@heartbeat/shared";
import { nutritionDayFixture } from "./test-fixtures";
import { calorieChartData, ALL_CATEGORIES, dailyCalories, filterFoods, foodFieldSources, indexFoods, menuCategories, NUTRIENT_DISPLAY, isRated, nutrientDisplay, sumNutrients, targetBar } from "./nutrition";

const food = (id: string, overrides: Partial<Food> = {}): Food => ({
  id,
  name: id,
  category: "Breakfast",
  foodType: "Rehydratable",
  serving: "1 pouch",
  kcal: 100,
  proteinG: 10,
  calciumMg: 50,
  vitaminDUg: 1,
  sodiumMg: 200,
  ...overrides,
});

const meal = (id: number, foodId: string, eatenAt = "2026-11-14T08:00:00Z"): MealLog => ({ id, astronautId: "a1", foodId, eatenAt });

const eggs = food("scrambled-eggs", { name: "Scrambled Eggs" });
const coffee = food("coffee", { name: "Coffee", category: "Drinks", kcal: 5, vitaminDUg: null });
const mystery = food("mystery", { kcal: null });
const foods = indexFoods([eggs, coffee, mystery]);

describe("sumNutrients (the server's day-total rule: unknown values are counted, not added as 0)", () => {
  it("adds up known values", () => {
    const totals = sumNutrients([meal(1, "scrambled-eggs"), meal(2, "scrambled-eggs"), meal(3, "coffee")], foods);
    assert.deepEqual(totals.kcal, { atLeast: 205, unknownMeals: 0 });
  });

  it("counts a missing value or a food no longer on the menu as unknown", () => {
    const totals = sumNutrients([meal(1, "coffee"), meal(2, "retired"), meal(3, "scrambled-eggs")], foods);
    assert.deepEqual(totals.vitaminDUg, { atLeast: 1, unknownMeals: 2 });
  });
});

describe("dailyCalories", () => {
  it("totals calories per UTC day in time order", () => {
    const { points } = dailyCalories([meal(1, "scrambled-eggs", "2026-11-14T23:30:00Z"), meal(2, "coffee", "2026-11-13T08:00:00Z"), meal(3, "coffee", "2026-11-14T01:00:00Z")], foods);
    assert.deepEqual(points.map((p) => [new Date(p.tMs).toISOString().slice(0, 10), p.value]), [
      ["2026-11-13", 5],
      ["2026-11-14", 105],
    ]);
  });

  it("counts days whose total is a lower bound", () => {
    const { points, partialDays } = dailyCalories([meal(1, "mystery"), meal(2, "retired", "2026-11-13T08:00:00Z"), meal(3, "coffee", "2026-11-12T08:00:00Z")], foods);
    assert.equal(points.length, 3);
    assert.equal(partialDays, 2);
  });
});

describe("targetBar (the bar against the server's band)", () => {
  it("fills a goal toward the band's minimum, with no tick", () => {
    assert.deepEqual(targetBar(1000, { min: 2000, max: 2400 }, "min"), { percent: 50, tickPercent: null });
  });

  it("fills sodium toward its upper limit and marks the minimum as a tick", () => {
    assert.deepEqual(targetBar(1150, { min: 1500, max: 2300 }, "max"), { percent: 50, tickPercent: (1500 / 2300) * 100 });
  });

  it("clamps at 100 and gives nothing without the bound it fills toward", () => {
    assert.equal(targetBar(5000, { min: 2000, max: null }, "min")?.percent, 100);
    assert.equal(targetBar(50, { min: null, max: null }, "min"), null);
    assert.equal(targetBar(50, { min: 1500, max: null }, "max"), null);
  });
});

describe("menu filtering", () => {
  const menu = [eggs, coffee];

  it("lists All first, then categories in menu order", () => {
    assert.deepEqual(menuCategories(menu), [ALL_CATEGORIES, "Breakfast", "Drinks"]);
  });

  it("filters by category and by case-insensitive name search", () => {
    assert.deepEqual(filterFoods(menu, { query: "", category: "Drinks" }).map((f) => f.id), ["coffee"]);
    assert.deepEqual(filterFoods(menu, { query: "  EGG ", category: ALL_CATEGORIES }).map((f) => f.id), ["scrambled-eggs"]);
    assert.deepEqual(filterFoods(menu, { query: "egg", category: "Drinks" }), []);
  });
});

describe("foodFieldSources", () => {
  it("names each field's source from the menu's source list", () => {
    const sourced = food("x", { sourceByField: { kcal: "nasa", vitaminDUg: "usda-1" } });
    assert.deepEqual(foodFieldSources(sourced, [{ id: "nasa", title: "NASA menu", url: "https://nasa.example" }]), [
      { field: "Calories", title: "NASA menu", url: "https://nasa.example" },
      { field: "Vitamin D", title: "usda-1", url: null },
    ]);
  });
});

describe("nutrient display", () => {
  it("covers every shared nutrient, in the shared order, looked up by key", () => {
    assert.deepEqual(NUTRIENT_DISPLAY.map((n) => n.key), [...NUTRIENTS]);
    assert.equal(nutrientDisplay("sodiumMg").fillToward, "max");
  });

  it("knows whether the server rated any of a day's checks", () => {
    const day = nutritionDayFixture({}, true);
    assert.equal(isRated(day), false);
    assert.equal(isRated({ ...day, statuses: { ...day.statuses, calcium: "watch" } }), true);
  });
});

describe("calorieChartData", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");

  it("charts calories per day and notes days that are lower bounds", () => {
    const data = calorieChartData([meal(1, "mystery"), meal(2, "coffee", "2026-11-13T08:00:00Z")], foods, "7d", now);
    assert.equal(data.unit, "kcal");
    assert.equal(data.timeUnit, "day");
    assert.equal(data.note, "1 day(s) include items with no published calorie value, so their totals are lower bounds.");
  });

  it("has no note when every value is known", () => {
    assert.equal(calorieChartData([meal(1, "coffee")], foods, "7d", now).note, undefined);
  });
});
