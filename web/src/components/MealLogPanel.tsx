import type { Food, MealLog } from "@heartbeat/shared";
import type { FormAction } from "@/lib/action-result";
import { formatNumber, formatUtcClock } from "@/lib/domain/format";
import { POINTS_UNAVAILABLE } from "@/lib/domain/points";
import { ActionButton } from "./ActionButton";
import styles from "./meals.module.css";

/**
 * Today's meal log (UTC day) with remove buttons, and the points today's meal tasks have earned:
 * each meal task (breakfast, lunch, dinner) earns its points once, not per food logged (SPEC §7).
 */
interface MealLogPanelProps {
  meals: MealLog[];
  foodsById: ReadonlyMap<string, Food>;
  astronautId: string;
  removeMeal: FormAction;
  /** Points from today's meal tasks done, from the server's tasks; null when they could not be loaded. */
  mealPoints: number | null;
}

export function MealLogPanel({ meals, foodsById, astronautId, removeMeal, mealPoints }: MealLogPanelProps) {
  return (
    <section aria-labelledby="log-title" className="panel">
      <div className={styles.logHead}>
        <h2 id="log-title" className="panelTitle">
          Logged today
        </h2>
        {mealPoints === null ? (
          <span className="muted">{POINTS_UNAVAILABLE}</span>
        ) : (
          <span className={styles.logPoints}>+{formatNumber(mealPoints, 0)} pts from meal tasks</span>
        )}
      </div>
      {meals.length === 0 ? (
        <p className="muted">Nothing logged yet today.</p>
      ) : (
        <ul className={styles.log}>
          {meals.map((meal) => {
            const name = foodsById.get(meal.foodId)?.name ?? `Unknown item (${meal.foodId})`;
            return (
              <li key={meal.id} className={styles.logItem}>
                <span className={styles.logTime}>{formatUtcClock(meal.eatenAt)} UTC</span>
                <span className={styles.logName}>{name}</span>
                <ActionButton
                  action={removeMeal}
                  fields={{ astronautId, mealId: String(meal.id) }}
                  label="×"
                  accessibleLabel={`Remove ${name}`}
                  className={styles.remove}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
