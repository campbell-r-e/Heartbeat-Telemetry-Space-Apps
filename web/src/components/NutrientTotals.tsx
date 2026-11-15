import type { NutrientRange, NutritionDayStatus } from "@heartbeat/shared";
import { PERCENT, formatNumber } from "@/lib/domain/format";
import { NUTRIENT_DISPLAY, isRated, targetBar, type NutrientDisplay } from "@/lib/domain/nutrition";
import { StatusPill } from "./StatusPill";
import styles from "./detail.module.css";

function rangeText(range: NutrientRange, nutrient: NutrientDisplay): string {
  const format = (value: number) => formatNumber(value, nutrient.decimals);
  if (range.min !== null && range.max !== null) return `Target ${format(range.min)}–${format(range.max)} ${nutrient.unit}`;
  if (range.min !== null) return `Target at least ${format(range.min)} ${nutrient.unit}`;
  if (range.max !== null) return `Limit ${format(range.max)} ${nutrient.unit}`;
  return "no target (profile incomplete)";
}

interface TotalRowProps {
  nutrient: NutrientDisplay;
  today: NutritionDayStatus;
  /** Yesterday's ratings, or null when yesterday is not rated at all (the reason is shown once). */
  yesterday: NutritionDayStatus | null;
}

function TotalRow({ nutrient, today, yesterday }: TotalRowProps) {
  const total = today.totals[nutrient.key];
  const range = today.targets[nutrient.key];
  const bar = targetBar(total.atLeast, range, nutrient.fillToward);
  return (
    <li className={styles.total}>
      <div className={styles.totalLine}>
        <span>{nutrient.label}</span>
        <span className={styles.totalValue}>
          {formatNumber(total.atLeast, nutrient.decimals)} {nutrient.unit}
        </span>
      </div>
      {bar && (
        <div className={styles.barTrack}>
          <div
            className={styles.bar}
            role="meter"
            aria-valuenow={Math.round(bar.percent)}
            aria-valuemin={0}
            aria-valuemax={PERCENT}
            aria-label={`${nutrient.label} toward today's ${nutrient.fillToward === "max" ? "limit" : "target"}`}
          >
            <div className={styles.barFill} style={{ width: `${bar.percent}%` }} />
          </div>
          {bar.tickPercent !== null && <span className={styles.barTick} style={{ left: `${bar.tickPercent}%` }} aria-hidden="true" />}
        </div>
      )}
      <span className={styles.totalNotes}>
        <span className="muted">{rangeText(range, nutrient)}</span>
        {yesterday && (
          <span className="muted">
            Yesterday <StatusPill status={yesterday.statuses[nutrient.check]} small />
          </span>
        )}
        {total.unknownMeals > 0 && <span className="muted">At least: {total.unknownMeals} logged item(s) have no published value.</span>}
      </span>
    </li>
  );
}

interface NutrientTotalsProps {
  today: NutritionDayStatus | null;
  yesterday: NutritionDayStatus | null;
  /** The server's reason the Nutrition area is unrated (decision 15), shown when yesterday has no ratings. */
  yesterdayReason: string | null;
  /** Why the totals are missing, when the status could not be loaded. */
  statusProblem: string | null;
}

/**
 * Today's running totals against the server's target bands (unrated, decision: rate yesterday),
 * with yesterday's ratings beside them. Every number comes from the server's status.
 */
export function NutrientTotals({ today, yesterday, yesterdayReason, statusProblem }: NutrientTotalsProps) {
  const yesterdayRated = yesterday !== null && isRated(yesterday);
  return (
    <section aria-labelledby="totals-title" className="panel">
      <div className={styles.panelHead}>
        <h2 id="totals-title" className="panelTitle">
          Today&apos;s totals
        </h2>
        <span className="muted">UTC day · vs. daily target</span>
      </div>
      {today ? (
        <>
          {!yesterdayRated && yesterday && (
            <p className={styles.yesterdayNote}>
              <StatusPill status={null} small /> Yesterday is not rated{yesterdayReason ? `: ${yesterdayReason}` : "."}
            </p>
          )}
          <ul className={styles.totals}>
            {NUTRIENT_DISPLAY.map((nutrient) => (
              <TotalRow key={nutrient.key} nutrient={nutrient} today={today} yesterday={yesterdayRated ? yesterday : null} />
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.pending}>Totals and targets come from the rules engine status ({statusProblem ?? "not loaded"}).</p>
      )}
      <span className="muted">Calcium and vitamin D help slow bone loss in microgravity.</span>
    </section>
  );
}
