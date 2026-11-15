package org.heartbeat.watch.sensors

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import org.heartbeat.watch.domain.Reading
import java.time.Instant

/**
 * Whether the watch is on the wrist, confirmed by heart-rate contact: worn only while the heart rate sensor
 * reports a reading is available. "Acquiring" (just put on, still settling) and "off body" both count as not worn.
 * It also remembers when the current worn period began, so a sample delivered late (sensors batch their samples)
 * can be judged by its own time rather than the time it arrives.
 */
class WearState(private val now: () -> Instant) {
    private val _worn = MutableStateFlow(false)

    @Volatile
    private var wornSince: Instant? = null

    val worn: StateFlow<Boolean> = _worn.asStateFlow()

    fun onHeartRateContact(confirmed: Boolean) {
        if (confirmed && !_worn.value) wornSince = now()
        if (!confirmed) wornSince = null
        _worn.value = confirmed
    }

    /** Whether the watch has been on the wrist without a break from [at] until now. */
    fun wornThroughoutSince(at: Instant): Boolean = wornSince?.let { !at.isBefore(it) } ?: false
}

/**
 * Drops readings taken while the watch is not confirmed on the wrist (skin temperature off-wrist is room air).
 * Judged when the reading arrives; for batched samples use [WearState.wornThroughoutSince] with each sample's time.
 */
fun Flow<Reading>.onlyWhileWorn(wear: WearState): Flow<Reading> = filter { wear.worn.value }
