"use client";

import type { GroundNote } from "@heartbeat/shared";
import { formatUtcClock } from "@/lib/domain/format";
import { groundNoteText } from "@/lib/domain/relay";
import styles from "./surgeon.module.css";
import { useNow } from "./useNow";

/**
 * Notes the surgeon sent, each with where it is: on its way (counting down to the server's
 * deliverAt), delivered, or read (once the astronaut's read receipt has reached the ground).
 */
export function SentNotes({ notes, nowMs }: { notes: readonly GroundNote[]; nowMs: number }) {
  const now = useNow(nowMs);
  if (notes.length === 0) return null;
  return (
    <ul className={styles.sentNotes} aria-label="Notes sent">
      {notes.map((note) => (
        <li key={note.noteId} className={styles.sentNote}>
          <span className={styles.sentNoteText}>{note.text}</span>
          <span className={styles.sentNoteStatus} data-read={note.readAt ? "true" : "false"}>
            Sent {formatUtcClock(note.sentAt)} UTC · {groundNoteText(note, now)}
          </span>
        </li>
      ))}
    </ul>
  );
}
