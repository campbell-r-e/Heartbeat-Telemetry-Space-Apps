package org.heartbeat.watch.device

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import org.heartbeat.watch.sensors.sendOrWarn
import java.time.Clock
import java.time.Duration
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/** Battery percentage from the system's sticky battery broadcast; `null` if the system does not report it. */
fun batteryPercent(context: Context): Flow<Int?> = callbackFlow {
    val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            sendOrWarn(percentFrom(intent), TAG)
        }
    }
    val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
    val sticky = ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    sticky?.let { sendOrWarn(percentFrom(it), TAG) }
    awaitClose { context.unregisterReceiver(receiver) }
}.distinctUntilChanged()

private const val PERCENT = 100
private const val TAG = "DeviceFlows"

private fun percentFrom(intent: Intent): Int? {
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    return if (level < 0 || scale <= 0) null else level * PERCENT / scale
}

/** The battery percentage right now, from the BatteryManager; `null` if the system does not report it. */
fun currentBatteryPercent(context: Context): Int? {
    val capacity = context.getSystemService(BatteryManager::class.java)?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    return capacity?.takeIf { it in 0..PERCENT }
}

/** The current time, emitted now and then at the start of every minute (the screens show hours and minutes). */
fun minuteTicks(clock: () -> Clock): Flow<ZonedDateTime> = flow {
    while (true) {
        val now = ZonedDateTime.now(clock())
        emit(now)
        delay(Duration.between(now, now.truncatedTo(ChronoUnit.MINUTES).plusMinutes(1)).toMillis())
    }
}
