package org.heartbeat.watch.sensors.body

import android.content.Context
import com.samsung.android.service.health.tracking.data.DataPoint
import com.samsung.android.service.health.tracking.data.HealthTrackerType
import com.samsung.android.service.health.tracking.data.ValueKey
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.transform
import kotlinx.coroutines.flow.transformWhile
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.watchReading
import java.time.Instant

/** Samsung Health Sensor SDK behind the [BodySensors] seam. */
object BodySensorsFactory {
    fun create(context: Context): BodySensors =
        SamsungBodySensors(SamsungConnection(context.applicationContext).also(SamsungConnection::connect))
}

internal class SamsungBodySensors(private val connection: SamsungConnection) : BodySensors {

    override val state: StateFlow<BodySensorsState> = connection.state

    override fun interBeatIntervals(): Flow<BeatIntervals> =
        connection.events(HealthTrackerType.HEART_RATE_CONTINUOUS)
            .buffer(Channel.UNLIMITED) // every interval batch is uploaded; bounded by the queue cap downstream
            .transform { points -> points.forEach { emit(it.toBeatIntervals()) } }

    override fun skinTemperature(): Flow<Reading> =
        connection.events(HealthTrackerType.SKIN_TEMPERATURE_CONTINUOUS)
            .transform { points -> points.mapNotNull(DataPoint::toSkinTemperature).forEach { emit(it) } }

    override fun measureSpo2(): Flow<Measurement> =
        onDemand(HealthTrackerType.SPO2_ON_DEMAND) { points ->
            points.map(DataPoint::toSpo2Measurement)
        }

    override fun recordEcg(): Flow<Measurement> {
        val recording = EcgRecording()
        return onDemand(HealthTrackerType.ECG_ON_DEMAND) { batch ->
            val first = batch.first()
            listOf(recording.add(batch.map(DataPoint::ecgMillivolts), first.getValue(ValueKey.EcgSet.LEAD_OFF), first.instant()))
        }
    }

    /**
     * Runs an on-demand tracker until it produces a final result or fails. Progress hints are passed on; the flow ends
     * after the first [Measurement.Finished] or [Measurement.Failed]. How long to wait is decided by the caller
     * (OnDemandMeasurements), the same for every build.
     */
    private fun onDemand(
        type: HealthTrackerType,
        interpret: (List<DataPoint>) -> List<Measurement>,
    ): Flow<Measurement> {
        val untilFinal = connection.events(type)
            .transform { batch -> interpret(batch).forEach { emit(it) } }
            .transformWhile { measurement ->
                emit(measurement)
                measurement is Measurement.InProgress
            }
        return untilFinal
            .onStart { emit(Measurement.InProgress(MeasurementHint.STARTING)) }
            .catch { failure -> emit(Measurement.Failed(failure.message ?: failure.javaClass.simpleName)) }
    }
}

private fun DataPoint.instant(): Instant = Instant.ofEpochMilli(timestamp)

private fun DataPoint.toBeatIntervals(): BeatIntervals =
    BeatIntervals(
        validIntervalsMs = HeartRateCodes.validIntervals(
            getValue(ValueKey.HeartRateSet.IBI_LIST).orEmpty(),
            getValue(ValueKey.HeartRateSet.IBI_STATUS_LIST).orEmpty(),
        ),
        reportedAt = instant(),
    )

private fun DataPoint.toSkinTemperature(): Reading? {
    if (getValue(ValueKey.SkinTemperatureSet.STATUS) != SkinTemperatureCodes.SUCCESSFUL_MEASUREMENT) return null
    return watchReading(Metric.SKIN_TEMP, getValue(ValueKey.SkinTemperatureSet.OBJECT_TEMPERATURE).toDouble(), instant())
}

private fun DataPoint.toSpo2Measurement(): Measurement {
    val status = getValue(ValueKey.SpO2Set.STATUS)
    return if (status == Spo2Codes.COMPLETED) {
        Measurement.Finished(watchReading(Metric.SPO2, getValue(ValueKey.SpO2Set.SPO2).toDouble(), instant()))
    } else {
        Measurement.InProgress(Spo2Codes.hintFor(status))
    }
}

private fun DataPoint.ecgMillivolts(): Float = getValue(ValueKey.EcgSet.ECG_MV)
