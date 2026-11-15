package org.heartbeat.watch.domain

import java.time.Instant

/** A meal the astronaut logged on the dashboard (`GET /api/astronauts/:id/meals`). The watch never logs meals. */
data class MealLog(val foodId: String, val eatenAt: Instant)

/** A food on the space menu (`GET /api/menu`); [kcal] is `null` when the menu has no value for it, [category] when none is given. */
data class MenuFood(val id: String, val name: String, val kcal: Double?, val category: String? = null)

interface FoodRepository {
    suspend fun mealsBetween(astronautId: String, from: Instant, to: Instant): ServerResult<List<MealLog>>

    suspend fun menu(): ServerResult<List<MenuFood>>
}
