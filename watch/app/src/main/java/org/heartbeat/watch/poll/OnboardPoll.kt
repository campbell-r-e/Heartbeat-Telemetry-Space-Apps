package org.heartbeat.watch.poll

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import org.heartbeat.watch.upload.RetryPolicy
import kotlin.time.Duration

/** One thing the watch asks the onboard server each round, e.g. the surgeon notes; [name] is for the log. */
class PollStep(val name: String, val refresh: suspend () -> Unit)

/**
 * One loop for what the watch hears from the onboard server in the background (SPEC §9.3): each round runs the [steps]
 * in order (surgeon notes, then points and badges), so the radio wakes once per round, then pauses for [interval].
 * Each step is contained: one that throws is logged and the round goes on, so a broken badge store can never stop
 * note checks or crash the app (pending owner review). Cancellation still ends the loop.
 */
class OnboardPoll(
    private val steps: List<PollStep>,
    private val log: (String, Throwable) -> Unit,
    private val interval: Duration = INTERVAL,
) {
    /** Runs rounds until canceled. */
    suspend fun run() {
        while (currentCoroutineContext().isActive) {
            runRound()
            delay(interval)
        }
    }

    suspend fun runRound() {
        steps.forEach { step -> runContained(step) }
    }

    private suspend fun runContained(step: PollStep) {
        try {
            step.refresh()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log("Onboard poll: ${step.name} failed; going on with the round", e)
        }
    }

    companion object {
        /**
         * The pause between rounds, the upload cadence: a note or a badge reaches the watch about this long after the
         * server has it, plus the time the round's requests take.
         */
        val INTERVAL: Duration = RetryPolicy.DEFAULT_INTERVAL
    }
}
