package org.heartbeat.watch.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import org.heartbeat.watch.ui.components.ListRow
import org.heartbeat.watch.ui.components.ListScreen
import org.heartbeat.watch.ui.components.MockupText
import org.heartbeat.watch.ui.components.ReadingRow
import org.heartbeat.watch.ui.components.RowContent
import org.heartbeat.watch.ui.model.FoodTodayUi
import org.heartbeat.watch.ui.model.HeaderUi
import org.heartbeat.watch.ui.model.MealRowUi
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupType

/**
 * Today's meals, read-only, approved mockup watch-food-large: one row per meal (time, category, food) and the total;
 * meals are added on the dashboard's meal picker.
 */
@Composable
fun FoodTodayScreen(header: HeaderUi, food: FoodTodayUi, onBack: () -> Unit) {
    ListScreen(time = header.time, title = "Food today", onBack = onBack) {
        when (food) {
            FoodTodayUi.Loading -> item { Message("Loading…") }
            is FoodTodayUi.Failed -> item { Message(food.message) }
            is FoodTodayUi.Loaded -> {
                food.meals.forEach { meal ->
                    item {
                        MealRow(meal)
                    }
                }
                item {
                    val total = food.total
                    ReadingRow(RowContent(total.label, total.note, total.kcal, unit = KCAL, valuePx = MockupType.SMALL_NUMBER))
                }
            }
        }
    }
}

/**
 * One meal: the time, the menu category (or "kcal not on menu"), then the food across the whole row as a worded value
 * (Inter, like "Not taken yet"), wrapping onto as many lines as it needs so the whole name is always readable.
 */
@Composable
private fun MealRow(meal: MealRowUi) {
    ListRow {
        Column(Modifier.fillMaxWidth()) {
            MockupText(meal.time, MockupType.ROW_LABEL, color = MockupColors.Muted, maxLines = 1)
            MockupText(meal.note, MockupType.NOTE, color = MockupColors.Muted)
            MockupText(meal.name, MockupType.TEXT_VALUE, Modifier.fillMaxWidth(), weight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun Message(text: String) {
    MockupText(text, MockupType.BODY, Modifier.fillMaxWidth(), color = MockupColors.Muted, textAlign = TextAlign.Center)
}

private const val KCAL = "kcal"
