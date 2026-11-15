package org.heartbeat.watch.sensors.body

import android.content.Context
import android.util.Log
import com.samsung.android.service.health.tracking.ConnectionListener
import com.samsung.android.service.health.tracking.HealthTracker
import com.samsung.android.service.health.tracking.HealthTrackerException
import com.samsung.android.service.health.tracking.HealthTrackingService
import com.samsung.android.service.health.tracking.data.DataPoint
import com.samsung.android.service.health.tracking.data.HealthTrackerType
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import org.heartbeat.watch.sensors.sendOrWarn

/** Owns the one connection to Samsung's health tracking service and hands out tracker event streams. */
internal class SamsungConnection(private val context: Context) {
    private val _state = MutableStateFlow<BodySensorsState>(BodySensorsState.Connecting)
    private var service: HealthTrackingService? = null
    private var supportedTypes: Set<HealthTrackerType> = emptySet()

    val state: StateFlow<BodySensorsState> = _state.asStateFlow()

    @Synchronized
    fun connect() {
        _state.value = BodySensorsState.Connecting
        val listener = object : ConnectionListener {
            override fun onConnectionSuccess() = onConnected()

            override fun onConnectionEnded() {
                _state.value = BodySensorsState.Unavailable("Samsung health service disconnected")
            }

            override fun onConnectionFailed(exception: HealthTrackerException) {
                Log.w(TAG, "Connection failed: code ${exception.errorCode}", exception)
                _state.value = BodySensorsState.Unavailable(describe(exception))
            }
        }
        service = HealthTrackingService(listener, context).also(HealthTrackingService::connectService)
    }

    /**
     * Streams one tracker's data batches once the service is connected. The flow fails with [TrackerUnavailable]
     * if the service or this tracker is missing, and with [TrackerFailure] if the tracker reports an error.
     */
    fun events(type: HealthTrackerType): Flow<List<DataPoint>> = callbackFlow {
        reconnectIfLost()
        awaitConnected()
        if (type !in supportedTypes) throw TrackerUnavailable("This watch has no $type tracker")
        val tracker = checkNotNull(service).getHealthTracker(type)
        tracker.setEventListener(object : HealthTracker.TrackerEventListener {
            override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
                if (dataPoints.isNotEmpty()) sendOrWarn(dataPoints.toList(), TAG)
            }

            override fun onFlushCompleted() = Unit

            override fun onError(error: HealthTracker.TrackerError) {
                close(TrackerFailure(type, error))
            }
        })
        awaitClose { tracker.unsetEventListener() }
    }

    /** A stream restarted after the service went away (or never came up) asks for a fresh connection. */
    @Synchronized
    private fun reconnectIfLost() {
        if (_state.value !is BodySensorsState.Unavailable) return
        Log.i(TAG, "Reconnecting to Samsung's health service")
        service?.disconnectService()
        connect()
    }

    private suspend fun awaitConnected() {
        when (val connected = state.first { it !is BodySensorsState.Connecting }) {
            is BodySensorsState.Connected -> Unit
            else -> throw TrackerUnavailable(connected.toString())
        }
    }

    private fun onConnected() {
        val types = service?.trackingCapability?.supportHealthTrackerTypes.orEmpty().toSet()
        Log.i(TAG, "Connected; supported trackers: ${types.sortedBy { it.name }}")
        supportedTypes = types
        _state.value = BodySensorsState.Connected(types.mapNotNull(::bodySensorFor).toSet())
    }

    private fun bodySensorFor(type: HealthTrackerType): BodySensor? =
        when (type) {
            HealthTrackerType.HEART_RATE_CONTINUOUS -> BodySensor.BEAT_INTERVALS
            HealthTrackerType.SKIN_TEMPERATURE_CONTINUOUS -> BodySensor.SKIN_TEMPERATURE
            HealthTrackerType.SPO2_ON_DEMAND -> BodySensor.SPO2
            HealthTrackerType.ECG_ON_DEMAND -> BodySensor.ECG
            else -> null
        }

    private fun describe(exception: HealthTrackerException): String =
        when (exception.errorCode) {
            HealthTrackerException.PACKAGE_NOT_INSTALLED -> "Samsung Health service is not installed"
            HealthTrackerException.OLD_PLATFORM_VERSION -> "Samsung Health service needs an update"
            else -> "Samsung Health connection failed (code ${exception.errorCode})"
        }

    private companion object {
        const val TAG = "SamsungConnection"
    }
}

/** A tracker refused to deliver data; SDK_POLICY_ERROR means developer mode is off in Samsung Health. */
internal class TrackerFailure(type: HealthTrackerType, val error: HealthTracker.TrackerError) :
    Exception("$type tracker error: $error")

internal class TrackerUnavailable(reason: String) : Exception(reason)
