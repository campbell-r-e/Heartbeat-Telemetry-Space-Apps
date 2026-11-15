package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.DerivedValues
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.StatusSnapshot
import org.heartbeat.watch.domain.TaskKind
import org.heartbeat.watch.reminders.ReminderPlan
import org.heartbeat.watch.time.UtcTime
import java.time.ZonedDateTime
import java.util.Locale

/** What one tile shows: which metric, how to format it, and what to say when there is no reading. */
private data class TileSpec(
    val label: String,
    val metric: Metric,
    val decimals: Int,
    val emptyNote: String,
    val measurement: MeasurementKind? = null,
    /** The watch stream that feeds this tile, when it is not [metric] itself (HRV comes from beat intervals). */
    val sensor: Metric = metric,
    /** Measured with Samsung's sensors, so the tile says why while they are not available. */
    val samsung: Boolean = false,
)

/** Everything the readings pages are built from. */
data class ReadingsInput(
    val newest: Map<Metric, Reading>,
    val statuses: StatusSnapshot?,
    /** The server's daily schedule, or `null` if none was ever received. */
    val schedule: List<ScheduledTask>?,
    val derived: DerivedValues,
    val exactAlarmsAllowed: Boolean,
    /** Watch sensor streams that are failing and being retried. */
    val unavailableSensors: Set<Metric>,
    /** Why Samsung's sensors are not available ("Samsung Health starting…"), or `null` when they are. */
    val samsungSensorsNote: String?,
    val now: ZonedDateTime,
)

/** The three readings lists (SPEC §9.3), built from the newest readings the watch knows. */
class ReadingsPresenter {

    fun pages(input: ReadingsInput): List<ReadingsPageUi> =
        ReadingsPage.entries.map { page ->
            when (page) {
                ReadingsPage.VITALS -> vitals(input)
                ReadingsPage.RECOVERY -> ReadingsPageUi(page, "Recovery & body", recoveryTiles(input))
                ReadingsPage.CABIN -> ReadingsPageUi(page, "Cabin", cabinTiles(input), showsSettingsButton = true)
            }
        }

    /** Without exact alarms the Vitals list starts with the "Reminders may be late" notice. */
    private fun vitals(input: ReadingsInput): ReadingsPageUi =
        ReadingsPageUi(
            ReadingsPage.VITALS,
            "Vitals",
            VITALS.map { tileFor(it, input) } + ecgTile(input),
            showsRemindersLateNotice = !input.exactAlarmsAllowed,
        )

    /** In the order of the approved list mockup: HRV, exercise, sleep, then muscle mass. */
    private fun recoveryTiles(input: ReadingsInput): List<TileUi> =
        listOf(
            hrvTile(input),
            exerciseTile(input),
            tileFor(SLEEP, input),
            tileFor(MUSCLE_MASS, input),
        )

    /** Radiation first, then the ship's air, then the watch's own cabin readings; the gear follows in the screen. */
    private fun cabinTiles(input: ReadingsInput): List<TileUi> = listOf(radiationTile(input)) + CABIN.map { tileFor(it, input) }

    private fun tileFor(spec: TileSpec, input: ReadingsInput): TileUi {
        val reading = input.newest[spec.metric]
        val scalar = (reading?.value as? ReadingValue.Scalar)?.number
        return TileUi(
            label = spec.label,
            value = scalar?.let { format(it, spec.decimals) } ?: NO_VALUE,
            unit = spec.metric.unit,
            note = note(spec, reading, input),
            status = input.statuses?.metrics?.get(spec.metric),
            measurement = spec.measurement,
        )
    }

    private fun note(spec: TileSpec, reading: Reading?, input: ReadingsInput): String =
        sensorNote(spec, input) ?: when {
            input.statuses?.noRecentData?.contains(spec.metric) == true -> NO_RECENT_DATA
            reading != null -> provenance(reading)
            else -> spec.emptyNote
        }

    /** Why the watch's own sensor for this tile gives nothing: its stream is failing, or Samsung's sensors are not available. */
    private fun sensorNote(spec: TileSpec, input: ReadingsInput): String? =
        when {
            spec.sensor in input.unavailableSensors -> SENSOR_UNAVAILABLE
            spec.samsung -> input.samsungSensorsNote
            else -> null
        }

    /**
     * HRV is derived by the server from the watch's raw beat intervals (`derived.hrv` in the status); until the
     * server has derived one, the tile falls back to the newest `hrv` reading it holds (the imported history).
     */
    private fun hrvTile(input: ReadingsInput): TileUi {
        val derived = input.derived.hrv ?: return tileFor(HRV, input)
        return tileFor(HRV, input).copy(
            value = format(derived.rmssdMs, 0),
            note = sensorNote(HRV, input) ?: "${UtcTime.time(derived.windowStart)} · $FROM_BEAT_INTERVALS",
        )
    }

    /** When the last ECG was taken and when the next one is due; no classification on the watch. */
    private fun ecgTile(input: ReadingsInput): TileUi {
        val lastEcg = input.newest[Metric.ECG]
        return TileUi(
            label = "ECG",
            value = lastEcg?.let(::clockTime) ?: NOT_TAKEN_YET,
            unit = "",
            note = input.samsungSensorsNote ?: EcgDue.note(input.schedule, input.now),
            status = input.statuses?.metrics?.get(Metric.ECG),
            measurement = MeasurementKind.ECG,
            valueIsText = true,
        )
    }

    /**
     * "45 /120 min": the server's exercise minutes against its daily goal (SPEC §5.4); "--" until it provides them,
     * and just "min" while the goal is unset.
     */
    private fun exerciseTile(input: ReadingsInput): TileUi {
        val exercise = input.derived.exercise
        return TileUi(
            label = "Exercise",
            value = exercise?.minutes?.toString() ?: NO_VALUE,
            unit = exercise?.goalMinutes?.let { "/$it min" } ?: MINUTES,
            note = when {
                exercise == null -> "from server, not yet"
                !exercise.ageKnown -> "age not set on server"
                exercise.minutes == null -> "no heart rate today"
                exercise.goalMinutes == null -> "goal not set on server"
                else -> "today"
            },
            status = null,
            measurement = null,
            longUnit = exercise?.goalMinutes != null,
        )
    }

    /**
     * The main value is the server's "times above normal" (the multiple of the 7-day average, the same baseline as
     * the radiation alert rule); the watch never computes it. The raw dose rate goes in the note.
     */
    private fun radiationTile(input: ReadingsInput): TileUi {
        val doseRate = input.newest[Metric.RADIATION_DOSE_RATE]
        val rate = (doseRate?.value as? ReadingValue.Scalar)?.number
        return TileUi(
            label = "Radiation",
            value = input.derived.radiationTimesNormal?.let { format(it, 1) } ?: NO_VALUE,
            unit = TIMES,
            note = rate?.let { "${format(it, 1)} ${Metric.RADIATION_DOSE_RATE.unit}" } ?: "from ship data",
            status = input.statuses?.metrics?.get(Metric.RADIATION_DOSE_RATE),
            measurement = null,
            unitAttached = true,
        )
    }

    private fun provenance(reading: Reading): String = "${clockTime(reading)} · ${SourceLabels.label(reading.source)}"

    private fun clockTime(reading: Reading): String = UtcTime.time(reading.takenAt)

    private fun format(number: Double, decimals: Int): String = String.format(Locale.US, "%.${decimals}f", number)

    private companion object {
        const val NO_VALUE = "--"
        const val NOT_TAKEN_YET = "Not taken yet"
        const val SENSOR_UNAVAILABLE = "sensor unavailable"
        const val NO_RECENT_DATA = "no recent data"
        const val FROM_BEAT_INTERVALS = "from beats"
        const val TIMES = "×"
        const val MINUTES = "min"

        val VITALS = listOf(
            TileSpec("Heart rate", Metric.HEART_RATE, 0, "no reading yet"),
            TileSpec("Blood oxygen", Metric.SPO2, 0, "tap to measure", MeasurementKind.SPO2, samsung = true),
            TileSpec("Skin temp", Metric.SKIN_TEMP, 1, "no reading yet", samsung = true),
        )

        val HRV = TileSpec("HRV", Metric.HRV, 0, "from server, not yet", sensor = Metric.IBI, samsung = true)
        val SLEEP = TileSpec("Sleep", Metric.SLEEP, 1, "no sleep data yet")
        val MUSCLE_MASS = TileSpec("Muscle mass", Metric.BODY_COMPOSITION, 1, "not measured yet")

        val CABIN = listOf(
            TileSpec("CO₂", Metric.CO2, 1, "from ship data"),
            TileSpec("Cabin temp", Metric.CABIN_TEMP, 1, "from ship data"),
            TileSpec("Humidity", Metric.HUMIDITY, 0, "from ship data"),
            TileSpec("Pressure", Metric.PRESSURE, 0, "watch barometer"),
            TileSpec("Noise", Metric.NOISE, 0, "not measured yet"),
        )
    }
}

/**
 * The ECG tile's "next" note from the server's schedule, in UTC like every time on the watch ("next 09:00 UTC",
 * "tomorrow" by the UTC day).
 */
object EcgDue {
    fun note(schedule: List<ScheduledTask>?, now: ZonedDateTime): String {
        if (schedule == null) return "no schedule yet"
        val next = ReminderPlan.nextOfKind(schedule, TaskKind.ECG, now)?.toInstant() ?: return "not scheduled"
        val day = if (UtcTime.date(next) == UtcTime.date(now.toInstant())) "" else " tomorrow"
        return "next ${UtcTime.time(next)}$day"
    }
}

/** Newest reading per metric across the watch's own readings and the server's latest lists. */
object NewestReadings {
    fun merge(vararg sources: Collection<Reading>): Map<Metric, Reading> =
        sources.asSequence()
            .flatten()
            .groupBy(Reading::metric)
            .mapValues { (_, readings) -> readings.maxBy(Reading::takenAt) }
}
