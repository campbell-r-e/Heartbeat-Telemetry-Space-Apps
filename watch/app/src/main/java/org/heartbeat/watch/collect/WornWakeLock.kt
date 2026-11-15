package org.heartbeat.watch.collect

import android.content.Context
import android.os.PowerManager
import kotlinx.coroutines.flow.StateFlow

/** Keeps the processor awake, or lets it sleep. The seam between [WornWakeLock] and Android's PowerManager. */
interface ProcessorWakeLock {
    fun acquire()

    fun release()
}

/**
 * Holds the processor awake while the watch is worn and collecting (owner decision). The Galaxy Watch5 Pro has no
 * wake-up accelerometer: while the processor sleeps, its sensor hub loses and reorders samples (6–9 Hz arrive instead
 * of 10, and no minute is complete), so sleep detection needs the processor awake. Off the wrist nothing is collected
 * that needs it, so the lock is never held then.
 */
class WornWakeLock(private val worn: StateFlow<Boolean>, private val lock: ProcessorWakeLock) {
    /** Follows [worn] until cancelled (the collection service stops); the lock is released either way. */
    suspend fun holdWhileWorn() {
        try {
            worn.collect { isWorn -> if (isWorn) lock.acquire() else lock.release() }
        } finally {
            lock.release()
        }
    }
}

/** A partial wake lock: the processor stays awake, the screen may turn off. Acquire and release are idempotent. */
class PartialWakeLock(context: Context) : ProcessorWakeLock {
    private val lock = context.getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, TAG)
        .apply { setReferenceCounted(false) }

    // A wake lock without a timeout is intended: it is held exactly while the watch is worn and collecting.
    @Suppress("WakelockTimeout")
    override fun acquire() = lock.acquire()

    override fun release() {
        if (lock.isHeld) lock.release()
    }

    private companion object {
        const val TAG = "heartbeat:worn-collection"
    }
}
