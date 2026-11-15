package org.heartbeat.watch.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import org.heartbeat.watch.ui.components.ListScreen
import org.heartbeat.watch.ui.components.MockupText
import org.heartbeat.watch.ui.components.PillButton
import org.heartbeat.watch.ui.model.HeaderUi
import org.heartbeat.watch.ui.model.NoteUi
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupType

/**
 * A note from the flight surgeon, approved mockup watch-notes-large (screens 2 and 3): the clock and "Flight Surgeon"
 * fixed at the top; when it was sent and the alert it is about; the text in large type, scrolling if long; then
 * **Mark read**, or "✓ Read · 14:10 UTC" in green once read, or neither when the server no longer has the note; then
 * why the last Mark read did not go through, if it did not.
 */
@Composable
fun NoteScreen(header: HeaderUi, note: NoteUi, onMarkRead: () -> Unit) {
    ListScreen(time = header.time, title = note.title) {
        // One item, so the list's edge fade (meant for rows leaving the screen) does not dim the sent line.
        item {
            Column(Modifier.fillMaxWidth()) {
                MockupText(note.sentLine, MockupType.NOTE, Modifier.fillMaxWidth(), color = MockupColors.Muted)
                MockupText(note.text, MockupType.NOTE_TEXT, Modifier.fillMaxWidth())
            }
        }
        item {
            val readLine = note.readLine
            if (readLine != null) {
                MockupText(
                    readLine, MockupType.BODY, Modifier.fillMaxWidth(),
                    color = MockupColors.Normal, weight = FontWeight.Bold, textAlign = TextAlign.Center,
                )
            } else if (note.buttonShown) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    PillButton(note.buttonLabel, enabled = note.buttonEnabled, onClick = onMarkRead)
                }
            }
        }
        note.error?.let { error ->
            item { MockupText(error, MockupType.NOTE, Modifier.fillMaxWidth(), color = MockupColors.Muted, textAlign = TextAlign.Center) }
        }
    }
}
