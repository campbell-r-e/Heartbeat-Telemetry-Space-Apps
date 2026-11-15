package org.heartbeat.watch.ui.state

import org.heartbeat.watch.sensors.body.BodySensorsState

/**
 * A short reason for the tiles fed by Samsung's sensors (HRV, skin temperature, SpO₂, ECG) while those sensors are
 * not available (owner decision); `null` once they are connected.
 */
object SamsungSensorNotes {
    fun noteFor(state: BodySensorsState): String? =
        when (state) {
            BodySensorsState.SdkNotBundled -> "Samsung SDK not in this build"
            BodySensorsState.Connecting -> "Samsung Health starting…"
            is BodySensorsState.Unavailable -> "Samsung sensors unavailable"
            is BodySensorsState.Connected -> null
        }
}
