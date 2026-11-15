"use client";

import { useState } from "react";
import type { Food, FoodSource } from "@heartbeat/shared";
import type { FormAction } from "@/lib/action-result";
import { NO_VALUE, formatNumber } from "@/lib/domain/format";
import { ALL_CATEGORIES, filterFoods, foodFieldSources, menuCategories, nutrientDisplay, type NutrientDisplay } from "@/lib/domain/nutrition";
import { ActionButton } from "./ActionButton";
import controls from "./controls.module.css";
import styles from "./meals.module.css";

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

const CALORIES = nutrientDisplay("kcal");
const PROTEIN = nutrientDisplay("proteinG");

function amount(value: number | null, nutrient: NutrientDisplay): string {
  return `${value === null ? NO_VALUE : formatNumber(value, nutrient.decimals)} ${nutrient.unit}`;
}

function FoodCard({ food, sources, astronautId, addMeal }: { food: Food; sources: FoodSource[]; astronautId: string; addMeal: FormAction }) {
  const fieldSources = foodFieldSources(food, sources);
  return (
    <li className={styles.food}>
      <h3 className={styles.foodName}>{food.name}</h3>
      <span className={styles.foodMeta}>{[food.category, food.foodType].filter(Boolean).join(" · ")}</span>
      <span className={styles.foodNumbers}>
        {amount(food.kcal, CALORIES)} · {amount(food.proteinG, PROTEIN)} protein
      </span>
      {fieldSources.length > 0 && (
        <details className={styles.sources}>
          <summary>Sources</summary>
          <ul>
            {fieldSources.map((row) => (
              <li key={row.field}>
                {row.field}: {row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.title}</a> : row.title}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ActionButton
        action={addMeal}
        fields={{ astronautId, foodId: food.id }}
        label="+ Add"
        accessibleLabel={`Add ${food.name}`}
        className={`${controls.accentButton} ${styles.add}`}
      />
    </li>
  );
}

/** Search box, category buttons and food cards (SPEC §9.1 meal picker). */
export function MealMenu({ foods, sources, astronautId, addMeal }: { foods: Food[]; sources: FoodSource[]; astronautId: string; addMeal: FormAction }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const shown = filterFoods(foods, { query, category });

  return (
    <section aria-label="Menu" className="panel">
      <label className={styles.search}>
        <SearchIcon />
        <span className="srOnly">Search the menu</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the menu, e.g. eggs" className={styles.searchInput} />
      </label>
      <div role="group" aria-label="Category" className={styles.categories}>
        {menuCategories(foods).map((name) => (
          <button key={name} type="button" aria-pressed={name === category} onClick={() => setCategory(name)} className={styles.category}>
            {name}
          </button>
        ))}
      </div>
      <ul className={styles.foods}>
        {shown.map((food) => (
          <FoodCard key={food.id} food={food} sources={sources} astronautId={astronautId} addMeal={addMeal} />
        ))}
      </ul>
      {shown.length === 0 && <span className="muted">No menu items match that search.</span>}
    </section>
  );
}
