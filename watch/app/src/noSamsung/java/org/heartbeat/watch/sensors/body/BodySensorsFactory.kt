package org.heartbeat.watch.sensors.body

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.Reading

/** Built when `app/libs` has no Samsung Health Sensor SDK: every Samsung-only sensor reports that it is missing. */
object BodySensorsFactory {
    fun create(context: Context): BodySensors = SdkNotBundledBodySensors
}

private object SdkNotBundledBodySensors : BodySensors {
    private const val REASON = "Samsung Health Sensor SDK is not in this build"

    override val state: StateFlow<BodySensorsState> = MutableStateFlow(BodySensorsState.SdkNotBundled)

    override fun interBeatIntervals(): Flow<BeatIntervals> = emptyFlow()

    override fun skinTemperature(): Flow<Reading> = emptyFlow()

    override fun measureSpo2(): Flow<Measurement> = flowOf(Measurement.Failed(REASON))

    override fun recordEcg(): Flow<Measurement> = flowOf(Measurement.Failed(REASON))
}
