package org.heartbeat.watch.reminders

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Exact alarms for reminders. A health-reminder app uses SCHEDULE_EXACT_ALARM, which the user grants in system
 * settings; USE_EXACT_ALARM is reserved by Android policy for alarm-clock and calendar apps.
 */
object ExactAlarms {
    fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    /** The system screen where the user allows this app's exact alarms. */
    fun settingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
}
