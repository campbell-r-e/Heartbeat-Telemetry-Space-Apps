package org.heartbeat.watch.ui.state

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.FoodRepository
import org.heartbeat.watch.domain.MenuFood
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.ui.model.FoodToday
import org.heartbeat.watch.ui.model.FoodTodayUi
import java.time.Clock

/** Loads the read-only "Food today" screen: today's meals from the server, named and counted with the menu. */
class FoodTodayLoader(
    private val food: FoodRepository,
    private val clock: () -> Clock,
    private val astronautId: suspend () -> String,
    private val log: (String) -> Unit,
) {
    private val _state = MutableStateFlow<FoodTodayUi?>(null)
    private var job: Job? = null

    /** The menu does not change while the app runs, so it is fetched once and kept. */
    private var menu: List<MenuFood>? = null

    /** `null` while the screen is closed. */
    val state: StateFlow<FoodTodayUi?> = _state.asStateFlow()

    /** A load still running from an earlier open is dropped, so only the newest one shows. */
    fun open(scope: CoroutineScope) {
        job?.cancel()
        _state.value = FoodTodayUi.Loading
        job = scope.launch { _state.value = load() }
    }

    /** Back: a load still in flight is canceled, so it cannot reopen the screen when it finishes. */
    fun close() {
        job?.cancel()
        job = null
        _state.value = null
    }

    suspend fun load(): FoodTodayUi {
        val now = clock().instant()
        val meals = food.mealsBetween(astronautId(), FoodToday.startOfDay(now), now)
        val menuFoods = menu ?: when (val result = food.menu()) {
            is ServerResult.Found -> result.value.also { menu = it }
            is ServerResult.Failed -> return failed(result.failure)
        }
        return when (meals) {
            is ServerResult.Found -> FoodToday.present(meals.value, menuFoods)
            is ServerResult.Failed -> failed(meals.failure)
        }
    }

    private fun failed(failure: ConnectionFailure): FoodTodayUi {
        log("Could not load today's meals: $failure")
        return FoodTodayUi.Failed("Can't load today's meals from the server.")
    }
}
