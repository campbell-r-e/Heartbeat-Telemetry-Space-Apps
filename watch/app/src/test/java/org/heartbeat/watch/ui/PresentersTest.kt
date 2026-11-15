package org.heartbeat.watch.ui

import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.DerivedHrv
import org.heartbeat.watch.domain.DerivedValues
import org.heartbeat.watch.domain.EcgSpec
import org.heartbeat.watch.domain.ExerciseToday
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.Status
import org.heartbeat.watch.domain.StatusSnapshot
import org.heartbeat.watch.domain.TaskKind
import org.heartbeat.watch.pointsSummary
import org.heartbeat.watch.reading
import org.heartbeat.watch.settings.Checked
import org.heartbeat.watch.settings.ConnectionSettings
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.settings.SettingsValidator
import org.heartbeat.watch.ui.model.ConnectionTone
import org.heartbeat.watch.ui.model.HomePresenter
import org.heartbeat.watch.ui.model.MeasurementPresenter
import org.heartbeat.watch.ui.model.MeasurementProgress
import org.heartbeat.watch.ui.model.MeasurementUi
import org.heartbeat.watch.ui.model.NewestReadings
import org.heartbeat.watch.ui.model.ReadingsInput
import org.heartbeat.watch.ui.model.ReadingsPage
import org.heartbeat.watch.ui.model.ReadingsPresenter
import org.heartbeat.watch.ui.model.RefusedInput
import org.heartbeat.watch.ui.model.SettingsLayout
import org.heartbeat.watch.ui.model.SettingsPresenter
import org.heartbeat.watch.ui.model.SourceLabels
import org.heartbeat.watch.ui.model.StatusSummaryUi
import org.heartbeat.watch.ui.model.TileUi
import org.heartbeat.watch.ui.model.TraceScaling
import org.heartbeat.watch.upload.ConnectionOutcome
import org.heartbeat.watch.upload.ConnectionStatus
import org.heartbeat.watch.upload.ReadingLosses
import org.heartbeat.watch.upload.UploadRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalTime
import java.time.ZonedDateTime

class ReadingsPresenterTest {
    private val presenter = ReadingsPresenter()
    private val now = ZonedDateTime.parse("2026-11-14T14:30Z")
    private val ecgAtNine = listOf(ScheduledTask("ecg", TaskKind.ECG, "ecg", "ECG", LocalTime.of(9, 0)))

    private fun input(
        newest: Map<Metric, Reading> = emptyMap(),
        statuses: StatusSnapshot? = null,
        derived: DerivedValues = DerivedValues.NONE_YET,
        exactAlarmsAllowed: Boolean = true,
        unavailableSensors: Set<Metric> = emptySet(),
        samsungSensorsNote: String? = null,
    ) = ReadingsInput(newest, statuses, ecgAtNine, derived, exactAlarmsAllowed, unavailableSensors, samsungSensorsNote, now)

    private fun tile(page: Int, label: String, input: ReadingsInput = input()): TileUi =
        presenter.pages(input)[page].tiles.single { it.label == label }

    @Test
    fun `builds the three pages in the mockup order`() {
        val pages = presenter.pages(input())

        assertEquals(listOf("Vitals", "Recovery & body", "Cabin"), pages.map { it.heading })
        assertEquals(listOf(4, 4, 6), pages.map { it.tiles.size })
        assertEquals(listOf(false, false, true), pages.map { it.showsSettingsButton })
        assertEquals(ReadingsPage.entries, pages.map { it.page })
    }

    @Test
    fun `every source has a human label from one table`() {
        val labels = listOf("watch", "wxserver", "zepp", "radlab", "osdr", "manual", "simulated").map { SourceLabels.label(ReadingSource(it)) }

        assertEquals(
            listOf("Galaxy Watch", "Galaxy Watch history", "Zepp watch", "ship data", "ship data", "manual", "simulated"),
            labels,
        )
        val history = reading(Metric.HEART_RATE, 70.0, T0, ReadingSource("wxserver"))
        assertEquals("14:00 UTC · Galaxy Watch history", tile(0, "Heart rate", input(mapOf(Metric.HEART_RATE to history))).note)
    }

    @Test
    fun `a failing watch sensor says so on its tile`() {
        val ui = input(unavailableSensors = setOf(Metric.SKIN_TEMP, Metric.IBI))

        assertEquals("sensor unavailable", tile(0, "Skin temp", ui).note)
        assertEquals("sensor unavailable", tile(1, "HRV", ui).note)
        assertEquals("no reading yet", tile(0, "Heart rate", ui).note)
    }

    @Test
    fun `exercise shows the server's minutes against its goal, and a dash until then`() {
        val pending = tile(1, "Exercise")
        val known = tile(1, "Exercise", input(derived = DerivedValues(hrv = null, exercise = ExerciseToday(minutes = 45, goalMinutes = 120, ageKnown = true), radiationTimesNormal = null)))

        assertEquals("--" to "min", pending.value to pending.unit)
        assertEquals("45" to "/120 min", known.value to known.unit)
        assertEquals("today", known.note)
    }

    @Test
    fun `exercise says what the server is missing`() {
        fun note(exercise: ExerciseToday) = tile(1, "Exercise", input(derived = DerivedValues(null, exercise, null)))

        val ageUnknown = note(ExerciseToday(minutes = null, goalMinutes = 120, ageKnown = false))
        val noHeartRate = note(ExerciseToday(minutes = null, goalMinutes = 120, ageKnown = true))
        val noGoal = note(ExerciseToday(minutes = 30, goalMinutes = null, ageKnown = true))

        assertEquals(Triple("--", "/120 min", "age not set on server"), Triple(ageUnknown.value, ageUnknown.unit, ageUnknown.note))
        assertEquals("no heart rate today", noHeartRate.note)
        assertEquals(Triple("30", "min", "goal not set on server"), Triple(noGoal.value, noGoal.unit, noGoal.note))
    }

    @Test
    fun `HRV shows the value the server derived from beat intervals`() {
        val derived = DerivedValues(DerivedHrv(rmssdMs = 41.6, windowStart = T0.plusSeconds(300)), exercise = null, radiationTimesNormal = null)

        val hrv = tile(1, "HRV", input(derived = derived))

        assertEquals("42" to "ms", hrv.value to hrv.unit)
        assertEquals("14:05 UTC · from beats", hrv.note)
    }

    @Test
    fun `a metric the server marks as having no recent data says so and has no status`() {
        val newest = mapOf(Metric.SKIN_TEMP to reading(Metric.SKIN_TEMP, 33.9))
        val statuses = StatusSnapshot(emptyMap(), emptyMap(), noRecentData = setOf(Metric.SKIN_TEMP))

        val skin = tile(0, "Skin temp", input(newest, statuses))

        assertEquals("no recent data", skin.note)
        assertNull(skin.status)
    }

    @Test
    fun `a tile without a reading shows a dash, never a made-up value`() {
        val heartRate = tile(0, "Heart rate")

        assertEquals("--", heartRate.value)
        assertEquals("no reading yet", heartRate.note)
    }

    @Test
    fun `a tile shows the value, unit and when and where it was measured`() {
        val co2 = reading(Metric.CO2, 2.443, T0, ReadingSource("osdr"))

        val tile = tile(2, "CO₂", input(mapOf(Metric.CO2 to co2)))

        assertEquals("2.4", tile.value)
        assertEquals("mmHg", tile.unit)
        assertEquals("14:00 UTC · ship data", tile.note)
    }

    @Test
    fun `sleep and muscle mass use the server's metrics and stay empty without data`() {
        assertEquals("--", tile(1, "Sleep").value)
        val sleep = reading(Metric.SLEEP, 6.5, T0, ReadingSource("seed"))
        assertEquals("6.5", tile(1, "Sleep", input(mapOf(Metric.SLEEP to sleep))).value)
        assertEquals("kg", tile(1, "Muscle mass").unit)
    }

    @Test
    fun `tiles stay neutral until the server sends statuses`() {
        val newest = mapOf(Metric.HEART_RATE to reading(Metric.HEART_RATE, 72.0))

        assertNull(tile(0, "Heart rate", input(newest)).status)
        val statuses = StatusSnapshot(emptyMap(), mapOf(Metric.HEART_RATE to Status.WATCH))
        assertEquals(Status.WATCH, tile(0, "Heart rate", input(newest, statuses)).status)
    }

    @Test
    fun `the ECG tile shows when the last ECG was taken and when the next is due`() {
        val ecg = Reading(Metric.ECG, ReadingValue.Series(listOf(0.1)), T0.plusSeconds(120), ReadingSource.WATCH)

        val taken = tile(0, "ECG", input(mapOf(Metric.ECG to ecg)))
        val notTaken = tile(0, "ECG")

        assertEquals("14:02 UTC", taken.value)
        assertEquals("next 09:00 UTC tomorrow", taken.note)
        assertEquals("Not taken yet", notTaken.value)
        assertTrue(notTaken.valueIsText)
        assertEquals(MeasurementKind.ECG, taken.measurement)
    }

    @Test
    fun `radiation shows the server's times-above-normal, with the raw dose rate in the note`() {
        val doseRate = mapOf(Metric.RADIATION_DOSE_RATE to reading(Metric.RADIATION_DOSE_RATE, 6.113, T0, ReadingSource("radlab")))

        val pending = tile(2, "Radiation", input(doseRate))
        val known = tile(2, "Radiation", input(doseRate, derived = DerivedValues(hrv = null, exercise = null, radiationTimesNormal = 1.5)))

        assertEquals("--" to "×", pending.value to pending.unit)
        assertEquals("6.1 µGy/h", pending.note)
        assertEquals("1.5", known.value)
    }

    @Test
    fun `without exact alarms the Vitals list starts with the reminders-may-be-late notice and keeps every reading`() {
        val normal = presenter.pages(input())[0]
        val late = presenter.pages(input(exactAlarmsAllowed = false))[0]

        assertFalse(normal.showsRemindersLateNotice)
        assertTrue(late.showsRemindersLateNotice)
        assertEquals(listOf("Heart rate", "Blood oxygen", "Skin temp", "ECG"), late.tiles.map { it.label })
    }

    @Test
    fun `each list has the approved rows in order`() {
        val pages = presenter.pages(input())

        assertEquals(listOf("HRV", "Exercise", "Sleep", "Muscle mass"), pages[1].tiles.map { it.label })
        assertEquals(listOf("Radiation", "CO₂", "Cabin temp", "Humidity", "Pressure", "Noise"), pages[2].tiles.map { it.label })
    }

    @Test
    fun `while Samsung's sensors are not available their tiles say why`() {
        val ui = input(samsungSensorsNote = "Samsung Health starting…")

        listOf(0 to "Blood oxygen", 0 to "Skin temp", 0 to "ECG", 1 to "HRV").forEach { (page, label) ->
            assertEquals(label, "Samsung Health starting…", tile(page, label, ui).note)
        }
        assertEquals("no reading yet", tile(0, "Heart rate", ui).note)
    }

    @Test
    fun `the newest reading wins whether it came from the watch or the server`() {
        val older = reading(Metric.SPO2, 95.0, T0)
        val newer = reading(Metric.SPO2, 97.0, T0.plusSeconds(60), ReadingSource("watch"))

        assertEquals(newer, NewestReadings.merge(listOf(newer), listOf(older))[Metric.SPO2])
    }
}

class HomePresenterTest {
    @Test
    fun `without server statuses every area is neutral and nothing is said about status`() {
        val home = HomePresenter.home(statuses = null, points = null, astronautId = "a1")

        assertEquals(Area.entries, home.dots.map { it.area })
        assertTrue(home.dots.all { it.status == null })
        assertEquals(StatusSummaryUi.None, home.summary)
        assertNull(home.pointsLine)
    }

    @Test
    fun `all normal only when the server has statuses and none is yellow or red`() {
        val allNormal = StatusSnapshot(Area.entries.associateWith { Status.NORMAL }, emptyMap())

        assertEquals(StatusSummaryUi.AllNormal, HomePresenter.summary(allNormal))
        assertEquals(StatusSummaryUi.None, HomePresenter.summary(StatusSnapshot(emptyMap(), emptyMap())))
    }

    @Test
    fun `server statuses and points are shown as given`() {
        val statuses = StatusSnapshot(mapOf(Area.RADIATION to Status.ALERT, Area.MIND to Status.WATCH), emptyMap())

        val home = HomePresenter.home(statuses, pointsSummary(totalPoints = 1240, streakDays = 9), astronautId = "a1")

        assertEquals(Status.ALERT, home.dots.single { it.area == Area.RADIATION }.status)
        assertEquals(StatusSummaryUi.Counts(alerts = 1, watches = 1), home.summary)
        assertEquals("1,240 pts · 9d", home.pointsLine)
    }

    @Test
    fun `another astronaut's points are not shown, so the line goes at once when the id changes`() {
        val home = HomePresenter.home(statuses = null, pointsSummary(totalPoints = 1240, astronautId = "a1"), astronautId = "a2")

        assertNull(home.pointsLine)
    }

    @Test
    fun `the streak is the server's days as given, whether or not today counts yet`() {
        val home = HomePresenter.home(statuses = null, pointsSummary(totalPoints = 0, streakDays = 0), astronautId = "a1")

        assertEquals("0 pts · 0d", home.pointsLine)
    }
}

class SettingsPresenterTest {
    private val presenter = SettingsPresenter()
    private val settings = ConnectionSettings("http://192.168.2.1:4000", token = "secret-token", astronautId = "a1")
    private val crew = mapOf("a1" to "Astronaut 1")

    @Test
    fun `connected layout shows all rows, the masked token, the crew name and the last upload`() {
        val status = ConnectionStatus(lastOutcome = ConnectionOutcome.Reached(T0), lastUpload = UploadRecord(T0, 12))

        val ui = presenter.settings(settings, status, crew, refused = null)

        assertEquals(SettingsLayout.NORMAL, ui.layout)
        assertEquals(listOf("192.168.2.1:4000", "Saved ••••", "a1 · Astronaut 1"), ui.rows.map { it.value })
        assertEquals("● Connected", ui.status.headline)
        assertEquals("Last upload 14:00 UTC · 12 readings", ui.status.detail)
        assertEquals(ConnectionTone.CONNECTED, ui.status.tone)
        assertEquals("Test connection", ui.buttonLabel)
    }

    @Test
    fun `before any test the not-tested layout asks to test`() {
        val ui = presenter.settings(settings, ConnectionStatus(), emptyMap(), refused = null)

        assertEquals(SettingsLayout.NOT_TESTED, ui.layout)
        assertEquals("○ Not tested yet", ui.status.headline)
        assertEquals("Tap Test connection to check the server.", ui.status.detail)
        assertEquals("a1", ui.rows.last().value)
    }

    @Test
    fun `failure layout names the address and the readings waiting`() {
        val status = ConnectionStatus(
            lastOutcome = ConnectionOutcome.Failed(T0, ConnectionFailure.Unreachable("timeout")),
            pendingReadings = 37,
        )

        val ui = presenter.settings(settings, status, crew, refused = null)

        assertEquals(SettingsLayout.FAILED, ui.layout)
        assertEquals(listOf(SettingField.SERVER_URL, SettingField.TOKEN), ui.rows.map { it.field })
        assertEquals("■ Can't reach server", ui.status.headline)
        assertEquals(
            "No answer from 192.168.2.1:4000. Check Wi-Fi and the address. 37 readings waiting to send.",
            ui.status.detail,
        )
        assertEquals("Try again", ui.buttonLabel)
    }

    @Test
    fun `an astronaut id the server does not know is named, with its row shown to fix it`() {
        val status = ConnectionStatus(
            lastOutcome = ConnectionOutcome.Failed(T0, ConnectionFailure.UnknownAstronaut("a7")),
            pendingReadings = 12,
        )

        val ui = presenter.settings(settings.copy(astronautId = "a7"), status, crew, refused = null)

        assertEquals(SettingsLayout.FAILED, ui.layout)
        assertEquals("■ Unknown astronaut", ui.status.headline)
        assertEquals("The server has no astronaut \"a7\". Check the astronaut id. 12 readings waiting to send.", ui.status.detail)
        assertEquals(listOf(SettingField.SERVER_URL, SettingField.TOKEN, SettingField.ASTRONAUT_ID), ui.rows.map { it.field })
    }

    @Test
    fun `with no astronaut id set it says so, instead of naming an empty id`() {
        val status = ConnectionStatus(
            lastOutcome = ConnectionOutcome.Failed(T0, ConnectionFailure.UnknownAstronaut("")),
            pendingReadings = 3,
        )

        val ui = presenter.settings(settings.copy(astronautId = ""), status, crew, refused = null)

        assertEquals("■ No astronaut set", ui.status.headline)
        assertEquals("Enter the astronaut id, for example a1. 3 readings waiting to send.", ui.status.detail)
        assertEquals(listOf(SettingField.SERVER_URL, SettingField.TOKEN, SettingField.ASTRONAUT_ID), ui.rows.map { it.field })
    }

    @Test
    fun `a refused address is shown with the mockup's message and example`() {
        val error = (SettingsValidator.check(SettingField.SERVER_URL, "192.168.2.1;4000") as Checked.Invalid).error

        val ui = presenter.settings(settings, ConnectionStatus(), crew, RefusedInput("192.168.2.1;4000", error)).inputError!!

        assertEquals("Server", ui.title)
        assertEquals("Server address", ui.fieldLabel)
        assertEquals("192.168.2.1;4000", ui.enteredValue)
        assertEquals("■ That isn't a valid address", ui.message)
        assertEquals("Use host:port, for example 192.168.2.1:4000", ui.hint)
    }

    @Test
    fun `lost readings are shown only when there are some`() {
        val clean = presenter.settings(settings, ConnectionStatus(), crew, refused = null)
        val lossy = presenter.settings(settings, ConnectionStatus(losses = ReadingLosses(rejected = 3)), crew, refused = null)

        assertNull(clean.lossesLine)
        assertEquals("3 readings rejected · 0 dropped (queue full)", lossy.lossesLine)
    }

    @Test
    fun `a refused token is never shown`() {
        val error = (SettingsValidator.check(SettingField.TOKEN, "my token") as Checked.Invalid).error

        val ui = presenter.settings(settings, ConnectionStatus(), crew, RefusedInput("my token", error)).inputError!!

        assertEquals("••••", ui.enteredValue)
    }

    @Test
    fun `addresses are shown without the scheme`() {
        assertEquals("10.0.0.1:4000", SettingsPresenter.displayAddress("http://10.0.0.1:4000/"))
        assertEquals("not a url", SettingsPresenter.displayAddress("not a url"))
    }
}

class MeasurementPresenterTest {
    private val presenter = MeasurementPresenter()

    private fun progress(kind: MeasurementKind, latest: Measurement) = MeasurementProgress(kind, latest)

    @Test
    fun `SpO2 shows Measuring with a spinning ring, since the sensor reports no progress`() {
        val ui = presenter.measurement(progress(MeasurementKind.SPO2, Measurement.InProgress(MeasurementHint.HOLD_STILL)), null)
            as MeasurementUi.Measuring

        assertNull(ui.secondsLeft)
        assertNull(ui.progress)
        assertEquals("Keep your arm still and the watch snug on your wrist.", ui.instruction)
    }

    @Test
    fun `ECG counts down the recording, which only runs with a fingertip on the button`() {
        val latest = Measurement.InProgress(MeasurementHint.RECORDING, recordedFraction = 1.0 / 3, recentTrace = listOf(0.0, 1.0, 0.5))

        val ui = presenter.measurement(progress(MeasurementKind.ECG, latest), null) as MeasurementUi.Measuring

        assertEquals(20, ui.secondsLeft)
        assertEquals(1f / 3, ui.progress!!, 1e-6f)
        assertEquals("Rest your arm and keep a fingertip on the top button.", ui.instruction)
        assertEquals(listOf(0f, 1f, 0.5f), ui.trace)
    }

    @Test
    fun `the result says sent only after an upload that followed it succeeded`() {
        val spo2 = reading(Metric.SPO2, 97.0, T0.plusSeconds(30))
        val finished = progress(MeasurementKind.SPO2, Measurement.Finished(spo2))

        val waiting = presenter.measurement(finished, UploadRecord(T0, 5)) as MeasurementUi.Result
        val sent = presenter.measurement(finished, UploadRecord(T0.plusSeconds(45), 1)) as MeasurementUi.Result

        assertEquals("97" to "%", waiting.value to waiting.unit)
        assertNull(waiting.sentLine)
        assertEquals("Sent to server · 14:00 UTC", sent.sentLine)
    }

    @Test
    fun `an ECG result is the seconds recorded`() {
        val ecg = Reading(
            Metric.ECG, ReadingValue.Series(List(EcgSpec.TARGET_SAMPLES) { 0.0 }), T0, ReadingSource.WATCH,
        )

        val ui = presenter.measurement(progress(MeasurementKind.ECG, Measurement.Finished(ecg)), null) as MeasurementUi.Result

        assertEquals("30" to "s", ui.value to ui.unit)
    }

    @Test
    fun `a failed measurement shows the approved advice, not the technical reason`() {
        val ui = presenter.measurement(progress(MeasurementKind.SPO2, Measurement.Failed("No result after 60 s")), null)
            as MeasurementUi.Failed

        assertEquals("Rest your arm on a surface, tighten the band a little, and try again.", ui.advice)
        assertEquals(MeasurementKind.SPO2, ui.kind)
    }

    @Test
    fun `a trace is thinned and scaled to 0 to 1`() {
        val scaled = TraceScaling.toUnitRange(List(1000) { it.toDouble() }, points = 100)

        assertEquals(100, scaled.size)
        assertEquals(0f, scaled.first())
        assertEquals(1f, scaled.last())
    }
}
