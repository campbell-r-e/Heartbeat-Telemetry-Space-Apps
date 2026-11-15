package org.heartbeat.watch.network

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration

/** Asks the platform for a specific network (on the watch: Wi-Fi) and reports when it comes and goes. */
fun interface NetworkRequester<N : Any> {
    /** Starts the request; returns the handle that withdraws it. */
    fun request(onAvailable: (N) -> Unit, onLost: (N) -> Unit): NetworkRequest
}

fun interface NetworkRequest {
    fun release()
}

/**
 * A network request held open from [hold] until [release]: the collection service holds Wi-Fi for as long
 * as it runs, so uploads never wait for Wi-Fi to come back up.
 */
class HeldNetwork<N : Any>(
    private val requester: NetworkRequester<N>,
    private val waitForNetwork: Duration,
) {
    private val available = MutableStateFlow<N?>(null)
    private var request: NetworkRequest? = null

    @Synchronized
    fun hold() {
        if (request == null) request = requester.request(onAvailable = { available.value = it }, onLost = ::onLost)
    }

    @Synchronized
    fun release() {
        request?.release()
        request = null
        available.value = null
    }

    /**
     * The held network once it is up (waiting up to [waitForNetwork]), or `null` when it is not held or did not
     * come up, so the caller uses the default network.
     */
    suspend fun current(): N? {
        if (!isHeld()) return null
        return available.value ?: withTimeoutOrNull(waitForNetwork) { available.filterNotNull().first() }
    }

    @Synchronized
    private fun isHeld(): Boolean = request != null

    private fun onLost(network: N) {
        available.compareAndSet(network, null)
    }
}
