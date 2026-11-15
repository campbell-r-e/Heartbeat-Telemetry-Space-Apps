package org.heartbeat.watch.ui

import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.MealLog
import org.heartbeat.watch.domain.MenuFood
import org.heartbeat.watch.network.FoodJson
import org.heartbeat.watch.ui.model.AreaNavigation
import org.heartbeat.watch.ui.model.Destination
import org.heartbeat.watch.ui.model.FoodToday
import org.heartbeat.watch.ui.model.FoodTotalUi
import org.heartbeat.watch.ui.model.MealRowUi
import org.heartbeat.watch.ui.model.PagerPages
import org.heartbeat.watch.ui.model.ReadingsPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class AreaNavigationTest {
    @Test
    fun `each home dot opens its page or screen`() {
        val destinations = Area.entries.associateWith(AreaNavigation::destinationFor)

        assertEquals(
            mapOf(
                Area.VITALS to Destination.Page(ReadingsPage.VITALS),
                Area.RADIATION to Destination.Page(ReadingsPage.CABIN),
                Area.GRAVITY to Destination.Page(ReadingsPage.RECOVERY),
                Area.CABIN to Destination.Page(ReadingsPage.CABIN),
                Area.FOOD to Destination.FoodToday,
                Area.MIND to Destination.Page(ReadingsPage.RECOVERY),
            ),
            destinations,
        )
    }

    @Test
    fun `back on a readings page goes home, and on home leaves the app`() {
        assertEquals(PagerPages.HOME, PagerPages.pageOnBack(ReadingsPage.CABIN.ordinal + 1))
        assertEquals(PagerPages.HOME, PagerPages.pageOnBack(ReadingsPage.VITALS.ordinal + 1))
        assertNull(PagerPages.pageOnBack(PagerPages.HOME))
    }
}

class FoodTodayTest {
    private val menu = listOf(
        MenuFood("scrambled-eggs", "Scrambled Eggs", 183.0, "Breakfast"),
        MenuFood("chicken-teriyaki", "Chicken Teriyaki", 150.0, "Entrées"),
        MenuFood("coffee", "Coffee", null, "Drinks"),
    )

    private fun meal(foodId: String, utcTime: String) = MealLog(foodId, Instant.parse("2026-11-14T${utcTime}:00Z"))

    @Test
    fun `lists today's meals in time order, in UTC, with the menu's names and categories, and totals the kcal`() {
        val ui = FoodToday.present(listOf(meal("chicken-teriyaki", "13:05"), meal("scrambled-eggs", "08:12")), menu)

        assertEquals(
            listOf(MealRowUi("08:12 UTC", "Breakfast", "Scrambled Eggs"), MealRowUi("13:05 UTC", "Entrées", "Chicken Teriyaki")),
            ui.meals,
        )
        assertEquals(FoodTotalUi("Total", "333", "Add meals on the dashboard"), ui.total)
    }

    @Test
    fun `a food without kcal still counts as a meal, is marked, and makes the total a lower bound`() {
        val ui = FoodToday.present(listOf(meal("coffee", "07:00"), meal("scrambled-eggs", "08:12")), menu)

        assertEquals("kcal not on menu", ui.meals.first().note)
        assertEquals("Breakfast", ui.meals.last().note)
        assertEquals("Total, at least" to "183", ui.total.label to ui.total.kcal)
    }

    @Test
    fun `an unknown food shows its id, and no meals says so`() {
        assertEquals("mystery-bar", FoodToday.present(listOf(meal("mystery-bar", "10:00")), menu).meals.single().name)
        assertEquals("No meals logged yet", FoodToday.present(emptyList(), menu).total.label)
    }

    @Test
    fun `today is the UTC day`() {
        assertEquals(Instant.parse("2026-11-14T00:00:00Z"), FoodToday.startOfDay(Instant.parse("2026-11-14T14:30:00Z")))
        assertEquals(Instant.parse("2026-11-15T00:00:00Z"), FoodToday.startOfDay(Instant.parse("2026-11-15T02:00:00Z")))
    }

    @Test
    fun `reads the server's meals and menu`() {
        val meals = FoodJson.decodeMeals("""[{"id":1,"astronautId":"a1","foodId":"scrambled-eggs","eatenAt":"2026-11-14T13:12:00.000Z"}]""")
        val foods = FoodJson.decodeMenu("""{"sources":[],"foods":[{"id":"scrambled-eggs","name":"Scrambled Eggs","category":"Breakfast","kcal":183}]}""")

        assertEquals(listOf(MealLog("scrambled-eggs", Instant.parse("2026-11-14T13:12:00Z"))), meals)
        assertEquals(listOf(MenuFood("scrambled-eggs", "Scrambled Eggs", 183.0, "Breakfast")), foods)
    }
}
