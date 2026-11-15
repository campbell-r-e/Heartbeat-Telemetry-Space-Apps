package org.heartbeat.watch.points

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import org.heartbeat.watch.MainActivity
import org.heartbeat.watch.R
import org.heartbeat.watch.device.notificationsAllowed
import org.heartbeat.watch.domain.Badge

/**
 * A badge is earned (owner decision, SPEC §9.3): a short buzz and "Badge earned: <name>" with what earned it. Tapping
 * it opens home. It never opens a screen by itself, so a running measurement is not interrupted.
 */
class BadgeNotifications(private val context: Context) : BadgeAnnouncer {

    /** False while notifications are not allowed, so the tracker announces the badge again once they are. */
    override fun notify(key: String, badge: Badge, buzz: Boolean): Boolean {
        if (!notificationsAllowed(context)) {
            Log.w(TAG, "Notification permission not granted; the badge \"${badge.name}\" waits to be announced")
            return false
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel())
        manager.notify(NOTIFICATION_TAG, key.hashCode(), notification(badge, buzz))
        return true
    }

    override fun buzz() {
        vibrator().vibrate(VibrationEffect.createWaveform(VIBRATION_PATTERN, NO_REPEAT))
    }

    private fun vibrator(): Vibrator =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }

    private fun channel() =
        NotificationChannel(CHANNEL_ID, context.getString(R.string.badges_channel), NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true)
            vibrationPattern = VIBRATION_PATTERN
        }

    /** Without [buzz] (the buzz came during a measurement) it is posted silently. */
    private fun notification(badge: Badge, buzz: Boolean) =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_reminder)
            .setContentTitle(context.getString(R.string.badge_earned, badge.name))
            .setContentText(badge.description)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(VIBRATION_PATTERN)
            .setSilent(!buzz)
            .setShowWhen(false)
            .setAutoCancel(true)
            .setContentIntent(openHome())
            .build()

    private fun openHome(): PendingIntent =
        PendingIntent.getActivity(
            context,
            OPEN_HOME_REQUEST,
            MainActivity.openHomeIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private companion object {
        const val TAG = "BadgeNotifications"
        const val CHANNEL_ID = "badges"

        /** Badges have their own tag, so their ids never collide with notes', reminders' or the collection's. */
        const val NOTIFICATION_TAG = "badge"
        const val OPEN_HOME_REQUEST = 0
        const val NO_REPEAT = -1

        /** One short buzz, unlike a note's long-short-long or a reminder's, so a badge is told apart by feel. */
        val VIBRATION_PATTERN = longArrayOf(0, 250)
    }
}
