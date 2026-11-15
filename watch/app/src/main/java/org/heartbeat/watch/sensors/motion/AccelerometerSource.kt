package org.heartbeat.watch.sensors.motion

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import org.heartbeat.watch.sensors.BootTime
import org.heartbeat.watch.sensors.sendOrWarn

/**
 * The accelerometer through Android's [SensorManager], sampled at 10 Hz and batched in the sensor hub for at most
 * [WristAngle.MAX_BATCH_DELAY]. The wake-up variant is preferred, as it wakes the processor to deliver a batch; the
 * Galaxy Watch5 Pro has none, so the collection service keeps the processor awake while the watch is worn
 * ([org.heartbeat.watch.collect.WornWakeLock]).
 */
class AccelerometerSource(context: Context) {
    private val sensorManager = context.getSystemService(SensorManager::class.java)

    fun samples(): Flow<AccelerationSample> {
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER, true)
            ?: sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (sensor == null) {
            Log.w(TAG, "This watch has no accelerometer")
            return emptyFlow()
        }
        Log.i(TAG, "Accelerometer: ${sensor.name}, wake-up ${sensor.isWakeUpSensor}, hub buffer ${sensor.fifoMaxEventCount} samples")
        return callbackFlow {
            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    val (x, y, z) = event.values
                    val at = BootTime.fromElapsedNanos(event.timestamp)
                    sendOrWarn(AccelerationSample(at, x.toDouble(), y.toDouble(), z.toDouble()), TAG)
                }

                override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
            }
            sensorManager.registerListener(listener, sensor, SAMPLING_PERIOD_US, MAX_REPORT_LATENCY_US)
            awaitClose { sensorManager.unregisterListener(listener) }
        }.buffer(BATCH_BUFFER)
    }

    private companion object {
        const val TAG = "AccelerometerSource"

        const val SAMPLING_PERIOD_US = 1_000_000 / WristAngle.SAMPLE_RATE_HZ

        /** See [WristAngle.MAX_BATCH_DELAY] for why the hub may hold samples for at most 20 s. */
        val MAX_REPORT_LATENCY_US = (WristAngle.MAX_BATCH_DELAY.toMillis() * 1_000).toInt()

        /** Room for two whole batches, so a batch delivered at once is never dropped by the flow. */
        val BATCH_BUFFER = 2 * MAX_REPORT_LATENCY_US / SAMPLING_PERIOD_US
    }
}
