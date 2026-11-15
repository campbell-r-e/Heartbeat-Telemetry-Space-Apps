package org.heartbeat.watch.sensors

import android.content.Context
import android.util.Log
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DataTypeAvailability
import androidx.health.services.client.data.DeltaDataType
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.watchReading

/**
 * Continuous heart rate from Health Services (works on any Wear OS watch, no Samsung SDK needed).
 * Its availability also tells [wear] whether the watch is on the wrist.
 */
class HeartRateSource(private val context: Context, private val wear: WearState) {

    fun readings(): Flow<Reading> = callbackFlow {
        val measureClient = HealthServices.getClient(context).measureClient
        val callback = object : MeasureCallback {
            override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {
                Log.i(TAG, "Heart rate availability: $availability")
                wear.onHeartRateContact(availability == DataTypeAvailability.AVAILABLE)
            }

            override fun onDataReceived(data: DataPointContainer) {
                val bootInstant = BootTime.bootInstant()
                data.getData(DataType.HEART_RATE_BPM)
                    .filter { it.value > 0 }
                    .forEach { sendOrWarn(watchReading(Metric.HEART_RATE, it.value, it.getTimeInstant(bootInstant)), TAG) }
            }
        }
        measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, callback)
        awaitClose { measureClient.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, callback) }
    }.buffer(Channel.UNLIMITED) // every sample is uploaded (owner decision); memory is bounded by the queue cap downstream

    private companion object {
        const val TAG = "HeartRateSource"
    }
}
