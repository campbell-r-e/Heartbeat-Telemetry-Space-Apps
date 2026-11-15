package org.heartbeat.watch.ui.state

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.DerivedValues
import org.heartbeat.watch.domain.FoodRepository
import org.heartbeat.watch.domain.MealLog
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.MenuFood
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.domain.Status
import org.heartbeat.watch.domain.StatusReport
import org.heartbeat.watch.domain.StatusSnapshot
import org.heartbeat.watch.reading
import org.heartbeat.watch.sensors.body.BodySensorsState
import org.heartbeat.watch.settings.Checked
import org.heartbeat.watch.settings.ConnectionSettings
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.settings.SettingsStore
import org.heartbeat.watch.settings.SettingsValidator
import org.heartbeat.watch.settings.ValidationError
import org.heartbeat.watch.ui.model.FoodTodayUi
import org.heartbeat.watch.upload.ConnectionMonitor
import org.heartbeat.watch.upload.ConnectionOutcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

private val FIXED_CLOCK: Clock = Clock.fixed(Instant.parse("2026-11-14T14:30:00Z"), ZoneOffset.UTC)

class ServerSnapshotPollerTest {
    private val unreachable = ServerResult.Failed(ConnectionFailure.Unreachable("Wi-Fi lost"))
    private val logs = mutableListOf<String>()

    @Test
    fun `a failed refresh keeps the readings the server sent last time`() = runTest {
        var answer: ServerResult<List<Reading>> = ServerResult.Found(listOf(reading(Metric.CO2, 2.4)))
        val poller = ServerSnapshotPoller({ answer }, { ServerResult.Found(StatusReport.NOT_AVAILABLE) }, { "a1" }, logs::add)

        poller.refresh()
        answer = unreachable
        poller.refresh()

        assertEquals(listOf(reading(Metric.CO2, 2.4)), poller.snapshot.value.readings.distinct())
        assertTrue(logs.isNotEmpty())
    }

    @Test
    fun `asks for the astronaut's and the ship's latest readings`() = runTest {
        val subjects = mutableListOf<String>()
        val poller = ServerSnapshotPoller(
            { subjects += it; ServerResult.Found(emptyList()) }, { ServerResult.Found(StatusReport.NOT_AVAILABLE) }, { "a1" }, logs::add,
        )

        poller.refresh()

        assertEquals(listOf("a1", "ship"), subjects)
    }

    @Test
    fun `statuses and derived values come from the status report and survive a failed refresh`() = runTest {
        val report = StatusReport(
            StatusSnapshot(mapOf(Area.RADIATION to Status.WATCH), emptyMap()),
            DerivedValues(hrv = null, exercise = null, radiationTimesNormal = 1.3),
        )
        var answer: ServerResult<StatusReport> = ServerResult.Found(report)
        val poller = ServerSnapshotPoller({ ServerResult.Found(emptyList()) }, { answer }, { "a1" }, logs::add)

        poller.refresh()
        answer = ServerResult.Failed(ConnectionFailure.Unreachable("Wi-Fi lost"))
        poller.refresh()

        assertEquals(report.statuses, poller.snapshot.value.statuses)
        assertEquals(1.3, poller.snapshot.value.derived.radiationTimesNormal!!, 0.0)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class MeasurementSessionTest {
    private val updates = MutableSharedFlow<Measurement>()
    private val logged = mutableListOf<String>()
    private val session = MeasurementSession({ updates }, logged::add)

    @Test
    fun `shows starting at once, then each update, then the result`() = runTest {
        session.start(MeasurementKind.SPO2, backgroundScope)
        assertEquals(Measurement.InProgress(MeasurementHint.STARTING), session.progress.value!!.latest)
        runCurrent()

        updates.emit(Measurement.Finished(reading(Metric.SPO2, 97.0)))
        runCurrent()

        assertTrue(session.progress.value!!.latest is Measurement.Finished)
    }

    @Test
    fun `a failure's technical reason goes to the log`() = runTest {
        session.start(MeasurementKind.SPO2, backgroundScope)
        runCurrent()

        updates.emit(Measurement.Failed("SPO2_ON_DEMAND tracker error: SDK_POLICY_ERROR"))
        runCurrent()

        assertEquals(listOf("SPO2 measurement failed: SPO2_ON_DEMAND tracker error: SDK_POLICY_ERROR"), logged)
    }

    @Test
    fun `closing clears the screen`() = runTest {
        session.start(MeasurementKind.ECG, backgroundScope)
        runCurrent()

        session.close()

        assertNull(session.progress.value)
    }
}

class SamsungSensorNotesTest {
    @Test
    fun `says why Samsung's sensors are not available, and nothing once connected`() {
        assertEquals("Samsung SDK not in this build", SamsungSensorNotes.noteFor(BodySensorsState.SdkNotBundled))
        assertEquals("Samsung Health starting…", SamsungSensorNotes.noteFor(BodySensorsState.Connecting))
        assertEquals("Samsung sensors unavailable", SamsungSensorNotes.noteFor(BodySensorsState.Unavailable("policy")))
        assertNull(SamsungSensorNotes.noteFor(BodySensorsState.Connected(emptySet())))
    }
}

class FoodTodayLoaderTest {
    private val logs = mutableListOf<String>()

    private class FakeFood(
        var menuAnswer: ServerResult<List<MenuFood>>,
        var mealsAnswer: ServerResult<List<MealLog>> = ServerResult.Found(emptyList()),
    ) : FoodRepository {
        var menuCalls = 0

        override suspend fun mealsBetween(astronautId: String, from: Instant, to: Instant) = mealsAnswer

        override suspend fun menu(): ServerResult<List<MenuFood>> {
            menuCalls++
            return menuAnswer
        }
    }

    @Test
    fun `a menu failure shows the failure screen and is retried next time`() = runTest {
        val food = FakeFood(ServerResult.Failed(ConnectionFailure.Unreachable("down")))
        val loader = FoodTodayLoader(food, { FIXED_CLOCK }, { "a1" }, logs::add)

        assertTrue(loader.load() is FoodTodayUi.Failed)
        food.menuAnswer = ServerResult.Found(listOf(MenuFood("eggs", "Scrambled Eggs", 183.0)))
        assertTrue(loader.load() is FoodTodayUi.Loaded)
        loader.load()

        assertEquals("the menu is fetched again only until it succeeds", 2, food.menuCalls)
    }

    @Test
    fun `Back cancels a load still in flight, so it cannot reopen the screen`() = runTest {
        val menuAnswer = CompletableDeferred<ServerResult<List<MenuFood>>>()
        val slow = object : FoodRepository {
            override suspend fun mealsBetween(astronautId: String, from: Instant, to: Instant) =
                ServerResult.Found(emptyList<MealLog>())

            override suspend fun menu() = menuAnswer.await()
        }
        val loader = FoodTodayLoader(slow, { FIXED_CLOCK }, { "a1" }, logs::add)

        loader.open(backgroundScope)
        runCurrent()
        loader.close()
        menuAnswer.complete(ServerResult.Found(emptyList()))
        runCurrent()

        assertNull(loader.state.value)
    }

    @Test
    fun `a meals failure shows the failure screen`() = runTest {
        val food = FakeFood(ServerResult.Found(emptyList()), ServerResult.Failed(ConnectionFailure.ServerError(500)))

        assertTrue(FoodTodayLoader(food, { FIXED_CLOCK }, { "a1" }, logs::add).load() is FoodTodayUi.Failed)
    }
}

class ConnectionSettingsActionsTest {
    private val monitor = ConnectionMonitor()
    private var uploadsRequested = 0

    private val store = object : SettingsStore {
        override val settings: Flow<ConnectionSettings> = MutableStateFlow(ConnectionSettings("http://h:1", "t", "a1"))

        override suspend fun save(field: SettingField, value: String): ValidationError? =
            (SettingsValidator.check(field, value) as? Checked.Invalid)?.error
    }

    private fun actions(failure: ConnectionFailure?) =
        ConnectionSettingsActions(store, monitor, { failure }, { T0 }, { uploadsRequested++ })

    @Test
    fun `a passing test sends what is waiting right away`() = runTest {
        actions(failure = null).testConnection()

        assertEquals(1, uploadsRequested)
        assertEquals(ConnectionOutcome.Reached(T0), monitor.status.value.lastOutcome)
    }

    @Test
    fun `a failing test records why and sends nothing`() = runTest {
        actions(ConnectionFailure.TokenRefused).testConnection()

        assertEquals(0, uploadsRequested)
        assertEquals(ConnectionOutcome.Failed(T0, ConnectionFailure.TokenRefused), monitor.status.value.lastOutcome)
    }

    @Test
    fun `a refused value is kept until dismissed or fixed`() = runTest {
        val actions = actions(failure = null)

        actions.save(SettingField.SERVER_URL, "192.168.2.1;4000")
        assertEquals("192.168.2.1;4000", actions.refused.first()?.enteredValue)

        actions.save(SettingField.SERVER_URL, "192.168.2.1:4000")
        assertNull(actions.refused.value)
    }
}
