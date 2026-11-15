"use client";

import { useActionState } from "react";
import type { FormAction } from "@/lib/action-result";
import { ActionFeedback } from "./ActionFeedback";
import styles from "./surgeon.module.css";

/** A note from the flight surgeon to one astronaut; it travels through the relay (SPEC §8). */
export function NoteForm({ astronautId, name, sendNote }: { astronautId: string; name: string; sendNote: FormAction }) {
  const [result, action, pending] = useActionState(sendNote, null);
  return (
    <form action={action} className={styles.noteLabel}>
      <input type="hidden" name="astronautId" value={astronautId} />
      <label className={styles.noteLabel}>
        Note to {name} (arrives after the link delay)
        <textarea name="text" rows={3} required placeholder="e.g. Recheck SpO₂ in 5 minutes." className={styles.textarea} />
      </label>
      <div className={styles.buttonRow}>
        <button type="submit" className={`${styles.btn} ${styles.btnAccent}`} disabled={pending}>
          Send note
        </button>
      </div>
      {result && <ActionFeedback result={result} />}
    </form>
  );
}
