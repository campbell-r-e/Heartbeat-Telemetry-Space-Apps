package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.Area

/** The readings pages, in swipe order after home. */
enum class ReadingsPage { VITALS, RECOVERY, CABIN }

/** Where tapping a home-screen area dot goes. */
sealed interface Destination {
    data class Page(val page: ReadingsPage) : Destination

    /** The read-only "Food today" screen; meals are added only on the dashboard. */
    data object FoodToday : Destination
}

object AreaNavigation {
    /**
     * Radiation and cabin data are on the Cabin page; gravity (exercise, muscle mass) and mind (HRV, sleep) are on
     * Recovery & body. The mood check-in is posted from the dashboard, so the watch has no check-in screen.
     */
    fun destinationFor(area: Area): Destination =
        when (area) {
            Area.VITALS -> Destination.Page(ReadingsPage.VITALS)
            Area.RADIATION, Area.CABIN -> Destination.Page(ReadingsPage.CABIN)
            Area.GRAVITY, Area.MIND -> Destination.Page(ReadingsPage.RECOVERY)
            Area.FOOD -> Destination.FoodToday
        }
}

/** The pager's pages: home first, then the readings pages. */
object PagerPages {
    const val HOME = 0

    /** Back from a readings page goes straight home (SPEC §9.3); on home it leaves the app as usual (null). */
    fun pageOnBack(current: Int): Int? = if (current == HOME) null else HOME
}
