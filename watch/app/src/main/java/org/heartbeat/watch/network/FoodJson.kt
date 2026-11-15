package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.heartbeat.watch.domain.MealLog
import org.heartbeat.watch.domain.MenuFood
import java.time.Instant

/** `GET /api/astronauts/:id/meals` (`[{"id","astronautId","foodId","eatenAt"}]`) and `GET /api/menu` (`{"foods":[...]}`). */
object FoodJson {

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decodeMeals(body: String): List<MealLog> =
        decodingServerReply("Meal list") {
            Json.parseToJsonElement(body).jsonArray.map { entry ->
                val meal = entry.jsonObject
                MealLog(
                    foodId = meal.getValue("foodId").jsonPrimitive.content,
                    eatenAt = Instant.parse(meal.getValue("eatenAt").jsonPrimitive.content),
                )
            }
        }

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decodeMenu(body: String): List<MenuFood> =
        decodingServerReply("Menu") {
            Json.parseToJsonElement(body).jsonObject.getValue("foods").jsonArray.map { entry ->
                val food = entry.jsonObject
                MenuFood(
                    id = food.getValue("id").jsonPrimitive.content,
                    name = food.getValue("name").jsonPrimitive.content,
                    kcal = food["kcal"]?.jsonPrimitive?.doubleOrNull,
                    category = food["category"]?.jsonPrimitive?.contentOrNull,
                )
            }
        }
}
