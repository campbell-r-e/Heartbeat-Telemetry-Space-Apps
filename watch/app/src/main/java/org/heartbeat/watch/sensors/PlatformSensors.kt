package org.heartbeat.watch.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.watchReading
import java.time.Duration
import java.time.Instant

/** The barometer through Android's [SensorManager]. Steps are not collected: astronauts do not walk in microgravity. */
class PlatformSensors(context: Context) {
    private val sensorManager = context.getSystemService(SensorManager::class.java)

    /** Cabin pressure from the watch barometer, at most one reading per [PRESSURE_INTERVAL]. */
    fun cabinPressure(): Flow<Reading> {
        val throttle = SampleThrottle(PRESSURE_INTERVAL)
        return samples(Sensor.TYPE_PRESSURE)
            .filter { throttle.accept(it.at) }
            .map { sample -> watchReading(Metric.PRESSURE, sample.firstValue.toDouble(), sample.at) }
    }

    private fun samples(sensorType: Int): Flow<SensorSample> {
        val sensor = sensorManager.getDefaultSensor(sensorType)
        if (sensor == null) {
            Log.w(TAG, "This watch has no sensor of type $sensorType")
            return emptyFlow()
        }
        return callbackFlow {
            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    sendOrWarn(SensorSample(event.values.first(), BootTime.fromElapsedNanos(event.timestamp)), TAG)
                }

                override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
            }
            sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
            awaitClose { sensorManager.unregisterListener(listener) }
        }
    }

    private data class SensorSample(val firstValue: Float, val at: Instant)

    private companion object {
        const val TAG = "PlatformSensors"
        val PRESSURE_INTERVAL: Duration = Duration.ofMinutes(1)
    }
}
