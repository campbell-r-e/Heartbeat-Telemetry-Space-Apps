import type { Metadata } from "next";
import Link from "next/link";
import { MealLogPanel } from "@/components/MealLogPanel";
import { MealMenu } from "@/components/MealMenu";
import { NutrientTotals } from "@/components/NutrientTotals";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/components/meals.module.css";
import { detailPath } from "@/lib/domain/areas";
import { indexFoods } from "@/lib/domain/nutrition";
import { areaReason } from "@/lib/domain/status";
import { sumMealTaskPoints } from "@/lib/domain/points";
import { getMenu } from "@/lib/onboard/api";
import { loadCrewSelection, loadMealsToday, loadStatus, loadTasksToday } from "@/lib/onboard/loaders";
import { requestNow } from "@/lib/request-clock";
import { addMealAction, removeMealAction } from "../actions";

export const metadata: Metadata = { title: "Log a meal · Heartbeat Telemetry" };

/** The meal picker (SPEC §9.1), on the real NASA/USDA menu values from the server (§5.5). */
export default async function MealPicker() {
  const nowMs = await requestNow();
  const { astronaut } = await loadCrewSelection();
  const [menu, mealsToday, status, tasks] = await Promise.all([
    getMenu(), loadMealsToday(astronaut.id, nowMs), loadStatus(astronaut.id), loadTasksToday(astronaut.id),
  ]);
  const derived = status.ok ? status.value.derived : null;

  return (
    <main className="page">
      <PageHeader title="Log a meal" subtitle={`Space food menu · ${astronaut.name} · NASA ISS Standard Menu values, vitamin D from NASA or USDA`} />
      <div className="columns">
        <div className="mainColumn">
          <MealMenu foods={menu.foods} sources={menu.sources} astronautId={astronaut.id} addMeal={addMealAction} />
        </div>
        <div className="sideColumn">
          <NutrientTotals
            today={derived?.nutritionToday ?? null}
            yesterday={derived?.nutritionYesterday ?? null}
            yesterdayReason={areaReason(status.ok ? status.value : null, "nutrition")}
            statusProblem={status.ok ? null : status.problem}
          />
          <MealLogPanel meals={mealsToday} foodsById={indexFoods(menu.foods)} astronautId={astronaut.id} removeMeal={removeMealAction} mealPoints={tasks.ok ? sumMealTaskPoints(tasks.value) : null} />
          <Link href={detailPath("nutrition")}>Nutrition history and learn more</Link>
        </div>
      </div>
      {menu.notes && (
        <details className={`panel ${styles.notes}`}>
          <summary>About these nutrition values</summary>
          <p>{menu.notes}</p>
        </details>
      )}
    </main>
  );
}
