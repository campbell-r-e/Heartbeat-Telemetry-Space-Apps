package org.heartbeat.watch.notes

import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.time.UtcTime

/** "Sent 14:06 UTC": when the surgeon sent the note, as the notification and the note screen both show it. */
fun SurgeonNote.sentLine(): String = "Sent ${UtcTime.time(sentAt)}"
