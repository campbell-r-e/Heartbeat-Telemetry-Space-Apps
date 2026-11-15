package org.heartbeat.watch.upload

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import kotlin.time.Duration

/**
 * Flushes the [UploadQueue] on the [RetryPolicy]'s schedule, or straight away when [requestUpload] is called,
 * and reports every flush to the [ConnectionMonitor].
 */
class UploadScheduler(
    private val queue: UploadQueue,
    private val monitor: ConnectionMonitor,
    private val now: () -> Instant,
    private val policy: RetryPolicy = RetryPolicy(),
) {
    private val uploadRequests = Channel<Unit>(Channel.CONFLATED)

    fun start(scope: CoroutineScope): Job {
        queue.pendingCount.onEach(monitor::recordPending).launchIn(scope)
        queue.losses.onEach(monitor::recordLosses).launchIn(scope)
        return scope.launch {
            while (isActive) {
                val report = queue.flush()
                monitor.recordFlush(now(), report)
                waitForNextUpload(policy.delayAfter(report))
            }
        }
    }

    fun requestUpload() {
        uploadRequests.trySend(Unit)
    }

    private suspend fun waitForNextUpload(delay: Duration) {
        withTimeoutOrNull(delay) { uploadRequests.receive() }
    }
}
