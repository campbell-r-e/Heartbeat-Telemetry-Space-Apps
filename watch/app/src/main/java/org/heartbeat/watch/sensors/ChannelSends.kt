package org.heartbeat.watch.sensors

import android.util.Log
import kotlinx.coroutines.channels.SendChannel

/**
 * Hands a sensor sample from a platform callback to the flow. If the flow's buffer is full or closed the sample is
 * lost, and that is logged rather than ignored. Heart rate and beat intervals use an unlimited buffer, so for them
 * this can only happen once the stream has been closed.
 */
fun <T> SendChannel<T>.sendOrWarn(element: T, tag: String) {
    val result = trySend(element)
    if (result.isFailure) Log.w(tag, "Dropped a sensor sample: ${if (result.isClosed) "stream closed" else "buffer full"}")
}
