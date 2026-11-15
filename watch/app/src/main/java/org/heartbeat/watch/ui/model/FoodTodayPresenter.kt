package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.MealLog
import org.heartbeat.watch.domain.MenuFood
import org.heartbeat.watch.time.UtcTime
import java.time.Instant
import kotlin.math.roundToInt

/** The "Food today" list (approved mockup watch-food-large). */
sealed interface FoodTodayUi {
    data object Loading : FoodTodayUi

    data class Loaded(val meals: List<MealRowUi>, val total: FoodTotalUi) : FoodTodayUi

    data class Failed(val message: String) : FoodTodayUi
}

/** One logged meal: its time as the label, the menu category (or "kcal not on menu") as the note, the food as the value. */
data class MealRowUi(val time: String, val note: String, val name: String)

/** The last row: "Total" (or "Total, at least" when a food has no kcal on the menu), the kcal and how to add meals. */
data class FoodTotalUi(val label: String, val kcal: String, val note: String)

object FoodToday {
    private const val KCAL_NOT_ON_MENU = "kcal not on menu"
    private const val ADD_MEALS = "Add meals on the dashboard"

    /** Midnight UTC today, as the start of the meals window: "today" is the UTC day. */
    fun startOfDay(now: Instant): Instant = UtcTime.date(now).atStartOfDay(UtcTime.ZONE).toInstant()

    fun present(meals: List<MealLog>, menu: List<MenuFood>): FoodTodayUi.Loaded {
        val foods = menu.associateBy(MenuFood::id)
        val ordered = meals.sortedBy(MealLog::eatenAt)
        return FoodTodayUi.Loaded(
            meals = ordered.map { row(it, foods[it.foodId]) },
            total = total(ordered.map { foods[it.foodId]?.kcal }),
        )
    }

    private fun row(meal: MealLog, food: MenuFood?) =
        MealRowUi(
            time = UtcTime.time(meal.eatenAt),
            note = if (food?.kcal == null) KCAL_NOT_ON_MENU else food.category.orEmpty(),
            name = food?.name ?: meal.foodId,
        )

    /**
     * The day's kcal. A food without a kcal value still counts as a meal; the total is then a lower bound,
     * "Total, at least" (owner decision), and never a guess.
     */
    private fun total(kcalPerMeal: List<Double?>): FoodTotalUi {
        val known = kcalPerMeal.filterNotNull().sum().roundToInt()
        val label = when {
            kcalPerMeal.isEmpty() -> "No meals logged yet"
            kcalPerMeal.any { it == null } -> "Total, at least"
            else -> "Total"
        }
        return FoodTotalUi(label = label, kcal = known.toString(), note = ADD_MEALS)
    }
}
