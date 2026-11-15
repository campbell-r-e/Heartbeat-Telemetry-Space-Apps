package org.heartbeat.watch.reminders

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.launch
import org.heartbeat.watch.appContainer

/** Fires at reminder time: shows the tasks due now and arms the next reminder. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val container = context.appContainer
        container.processScope.launch {
            try {
                val tasks = container.schedule.ensureLoaded().orEmpty()
                ReminderAlarms.dueTime(intent)?.let { ReminderNotifications.show(context, ReminderPlan.dueAt(tasks, it)) }
                container.rearmReminders()
            } finally {
                pending.finish()
            }
        }
    }
}

/** Alarms do not survive a reboot, so re-arm after a reboot and after a clock or time-zone change (SPEC §9.3). */
class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in RESCHEDULE_ACTIONS) return
        val pending = goAsync()
        val container = context.appContainer
        container.processScope.launch {
            try {
                container.rearmReminders()
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        val RESCHEDULE_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_TIME_CHANGED,
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED,
        )
    }
}
