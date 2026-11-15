package org.heartbeat.watch.notes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import org.heartbeat.watch.MainActivity
import org.heartbeat.watch.R
import org.heartbeat.watch.device.notificationsAllowed
import org.heartbeat.watch.domain.SurgeonNote

/**
 * A note arrives (approved mockup watch-notes-large, screen 1): the watch buzzes and posts "Note from Flight Surgeon"
 * with the text, "Sent 14:06 UTC" and an **Open** action. It never opens the note by itself, so a running ECG or SpO₂
 * measurement is not interrupted.
 */
class NoteNotifications(private val context: Context) : NoteAnnouncer {

    /** False while notifications are not allowed, so the inbox announces the note again once they are. */
    override fun announce(note: SurgeonNote): Boolean {
        if (!notificationsAllowed(context)) {
            Log.w(TAG, "Notification permission not granted; a note from the flight surgeon waits to be announced")
            return false
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel())
        manager.notify(NOTIFICATION_TAG, note.noteId.hashCode(), notification(note))
        return true
    }

    override fun dismiss(noteId: String) {
        context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_TAG, noteId.hashCode())
    }

    private fun channel() =
        NotificationChannel(CHANNEL_ID, context.getString(R.string.notes_channel), NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true)
            vibrationPattern = VIBRATION_PATTERN
        }

    /**
     * The collapsed card shows only two lines, so its text starts with the sent time ("Sent 14:06 UTC · Stay in…");
     * expanded, the sent time is on its own line after the note, as in the mockup.
     */
    private fun notification(note: SurgeonNote) =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_reminder)
            .setContentTitle(context.getString(R.string.note_title))
            .setContentText("${note.sentLine()} · ${note.text}")
            .setStyle(NotificationCompat.BigTextStyle().bigText("${note.text}\n${note.sentLine()}"))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(VIBRATION_PATTERN)
            .setShowWhen(false)
            .setAutoCancel(true)
            .setContentIntent(openIntent(note))
            .addAction(0, context.getString(R.string.note_open), openIntent(note))
            .build()

    private fun openIntent(note: SurgeonNote): PendingIntent =
        PendingIntent.getActivity(
            context,
            note.noteId.hashCode(),
            MainActivity.openNoteIntent(context, note.noteId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private companion object {
        const val TAG = "NoteNotifications"
        const val CHANNEL_ID = "surgeon_notes"

        /** Notes have their own tag, so their ids never collide with reminders' or the collection notification's. */
        const val NOTIFICATION_TAG = "surgeon_note"

        /** Long-short-long, unlike a reminder's buzz, so a note is told apart by feel. */
        val VIBRATION_PATTERN = longArrayOf(0, 400, 150, 200, 150, 400)
    }
}
