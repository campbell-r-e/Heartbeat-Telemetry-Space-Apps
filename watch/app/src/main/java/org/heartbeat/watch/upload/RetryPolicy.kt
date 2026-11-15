package org.heartbeat.watch.upload

import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * How long to wait before the next upload: the normal [interval] while the server answers,
 * and an exponential backoff from [firstRetry] up to [maxRetry] while it does not.
 */
class RetryPolicy(
    private val interval: Duration = DEFAULT_INTERVAL,
    firstRetry: Duration = DEFAULT_FIRST_RETRY,
    maxRetry: Duration = DEFAULT_MAX_RETRY,
) {
    private val backoff = Backoff(firstRetry, maxRetry)
    private var consecutiveFailures = 0

    fun delayAfter(report: FlushReport): Duration {
        val failed = report.failure?.isRetryable == true
        consecutiveFailures = if (failed) consecutiveFailures + 1 else 0
        return if (failed) backoff.delayAfter(consecutiveFailures) else interval
    }

    companion object {
        val DEFAULT_INTERVAL = 15.seconds
        val DEFAULT_FIRST_RETRY = 5.seconds
        val DEFAULT_MAX_RETRY = 5.minutes
    }
}
