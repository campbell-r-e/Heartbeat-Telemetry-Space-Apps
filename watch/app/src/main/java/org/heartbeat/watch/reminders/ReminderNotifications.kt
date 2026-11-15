package org.heartbeat.watch.reminders

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import org.heartbeat.watch.MainActivity
import org.heartbeat.watch.R
import org.heartbeat.watch.device.notificationsAllowed
import org.heartbeat.watch.domain.ScheduledTask

/** One vibrating notification per task; tapping it opens the matching measurement where the watch has one. */
object ReminderNotifications {
    private const val TAG = "ReminderNotifications"
    private const val CHANNEL_ID = "measurement_reminders"

    /** Short-long-short buzz so a reminder is felt even with the screen off. */
    private val VIBRATION_PATTERN = longArrayOf(0, 200, 120, 400, 120, 200)

    fun show(context: Context, tasks: List<ScheduledTask>) {
        if (!notificationsAllowed(context)) {
            Log.w(TAG, "Notification permission not granted; ${tasks.size} reminders not shown")
            return
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel(context))
        tasks.forEach { manager.notify(it.id.hashCode(), notification(context, it)) }
    }

    private fun channel(context: Context) =
        NotificationChannel(CHANNEL_ID, context.getString(R.string.reminder_channel), NotificationManager.IMPORTANCE_HIGH)
            .apply {
                enableVibration(true)
                vibrationPattern = VIBRATION_PATTERN
            }

    private fun notification(context: Context, task: ScheduledTask) =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_reminder)
            .setContentTitle(task.label)
            .setContentText(ReminderPlan.dueText(task))
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(VIBRATION_PATTERN)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, task))
            .build()

    private fun openIntent(context: Context, task: ScheduledTask): PendingIntent {
        val measurement = ReminderPlan.measurementFor(task)
        val intent = measurement?.let { MainActivity.openMeasurementIntent(context, it) }
            ?: MainActivity.openHomeIntent(context)
        return PendingIntent.getActivity(
            context,
            task.id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
