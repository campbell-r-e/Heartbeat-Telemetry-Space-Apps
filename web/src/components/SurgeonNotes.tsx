import type { OnboardNote } from "@heartbeat/shared";
import type { FormAction } from "@/lib/action-result";
import { formatUtcClock } from "@/lib/domain/format";
import { notesToShow, onboardNoteText } from "@/lib/domain/relay";
import { ActionButton } from "./ActionButton";
import controls from "./controls.module.css";
import styles from "./dashboard.module.css";

interface SurgeonNotesProps {
  astronautId: string;
  notes: readonly OnboardNote[];
  markRead: FormAction;
}

/**
 * Notes from the flight surgeon that have reached the astronaut (SPEC §8, §11 item 8): unread ones
 * stand out with a "Mark read" button, whose read receipt travels back to the ground.
 */
export function SurgeonNotes({ astronautId, notes, markRead }: SurgeonNotesProps) {
  const shown = notesToShow(notes);
  if (shown.length === 0) return null;
  return (
    <section aria-label="Notes from the flight surgeon" className={styles.notes}>
      {shown.map((note) => (
        <article key={note.noteId} className={styles.noteCard} data-unread={note.readAt ? "false" : "true"}>
          <div className={styles.noteHead}>
            <h2 className={styles.noteTitle}>Note from Flight Surgeon</h2>
            {note.readAt ? (
              <span className={styles.readReceipt}>✓ Read {formatUtcClock(note.readAt)} UTC</span>
            ) : (
              <ActionButton
                action={markRead}
                fields={{ astronautId, noteId: note.noteId }}
                label="Mark read"
                accessibleLabel="Mark this note from the flight surgeon read"
                className={controls.accentButton}
              />
            )}
          </div>
          <p className={styles.noteText}>{note.text}</p>
          <span className={styles.noteMeta}>{onboardNoteText(note)}</span>
        </article>
      ))}
    </section>
  );
}
