package org.heartbeat.watch.collect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.heartbeat.watch.R
import org.heartbeat.watch.appContainer

/**
 * A foreground service so the watch keeps collecting while the screen is off.
 * It shows the ongoing notification Android requires for health sensor access in the background.
 */
class TelemetryService : Service() {
    private var scope: CoroutineScope? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, ongoingNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        if (scope == null) {
            appContainer.wifi.hold()
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default).also {
                appContainer.newTelemetryCollector().start(it)
                it.launch { appContainer.newWornWakeLock().holdWhileWorn() }
            }
        }
        return START_STICKY
    }

    /** Wi-Fi is held for exactly as long as the service runs; cancelling the scope releases the wake lock. */
    override fun onDestroy() {
        scope?.cancel()
        scope = null
        appContainer.wifi.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ongoingNotification(): Notification {
        createChannel()
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_reminder)
            .setContentTitle(getString(R.string.collecting_title))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, getString(R.string.collecting_channel), NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "telemetry_collection"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, TelemetryService::class.java))
        }
    }
}
