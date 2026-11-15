package org.heartbeat.watch.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import org.heartbeat.watch.domain.ScheduledTask
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/** Arms one alarm for the next tasks due in the server's schedule; each firing re-arms the next. */
object ReminderAlarms {
    private const val TAG = "ReminderAlarms"
    private const val ALARM_REQUEST_CODE = 1
    private const val EXTRA_DUE_TIME = "org.heartbeat.watch.DUE_TIME"
    private val DUE_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    /** With no schedule (never received, or empty) nothing is armed: no reminder times are hard-coded. */
    fun arm(context: Context, tasks: List<ScheduledTask>?, now: ZonedDateTime) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val due = tasks?.let { ReminderPlan.nextDue(it, now) }
        if (due == null) {
            alarmManager.cancel(alarmIntent(context, dueTime = null))
            Log.i(TAG, "No schedule yet; no reminder armed")
            return
        }
        val at = due.at.toInstant().toEpochMilli()
        val intent = alarmIntent(context, due.at.toLocalTime())
        if (ExactAlarms.allowed(context)) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
        } else {
            Log.w(TAG, "Exact alarms not allowed; the reminder may fire late")
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
        }
        Log.i(TAG, "Next reminder at ${due.at} for ${due.tasks.map(ScheduledTask::id)}")
    }

    fun dueTime(intent: Intent): LocalTime? = intent.getStringExtra(EXTRA_DUE_TIME)?.let { LocalTime.parse(it, DUE_TIME) }

    /** The same request code and component every time, so a new alarm replaces the previous one. */
    private fun alarmIntent(context: Context, dueTime: LocalTime?): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java)
        dueTime?.let { intent.putExtra(EXTRA_DUE_TIME, DUE_TIME.format(it)) }
        return PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
