"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { FormAction } from "@/lib/action-result";
import { MOOD_CHOICES, STRESS_CHOICES, saveNote, scaleHint, type ScoreChoice } from "@/lib/domain/checkin";
import { MoodFace } from "./MoodFace";
import styles from "./checkin.module.css";

interface ScoreScaleProps {
  legend: string;
  hint: string;
  choices: readonly ScoreChoice[];
  picked: number | null;
  pick: (value: number) => void;
  /** The tile's picture: a drawn face for mood, the number for stress. */
  picture: (choice: ScoreChoice) => ReactNode;
}

function ScoreScale({ legend, hint, choices, picked, pick, picture }: ScoreScaleProps) {
  return (
    <fieldset className={styles.scale}>
      <legend className={styles.legend}>{legend}</legend>
      <span className={styles.hint}>{hint}</span>
      <div className={styles.choices}>
        {choices.map((choice) => (
          <button key={choice.value} type="button" aria-pressed={picked === choice.value} onClick={() => pick(choice.value)} className={styles.choice}>
            {picture(choice)}
            <span className={styles.caption}>{choice.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

interface CheckInFormProps {
  astronautId: string;
  /** "HH:MM" of today's scheduled check-in task, from the server's schedule. */
  checkInTime: string | null;
  submit: FormAction;
}

/** The daily mood (drawn faces) and stress (1–5) check-in, per the approved mockup (decision 9). */
export function CheckInForm({ astronautId, checkInTime, submit }: CheckInFormProps) {
  const [mood, setMood] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  /** True once a choice changes after the last save, so "Saved" never describes old choices. */
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const [result, formAction, pending] = useActionState(submit, null);
  const ready = mood !== null && stress !== null;
  const saved = result?.ok === true && !changedSinceSave;
  const choose = (set: (value: number) => void) => (value: number) => {
    set(value);
    setChangedSinceSave(true);
  };

  return (
    <form action={formAction} onSubmit={() => setChangedSinceSave(false)} className={`panel ${styles.form}`} aria-label="Check-in">
      <input type="hidden" name="astronautId" value={astronautId} />
      <input type="hidden" name="mood" value={mood ?? ""} />
      <input type="hidden" name="stress" value={stress ?? ""} />
      <ScoreScale
        legend="How is your mood?"
        hint={scaleHint("mood")}
        choices={MOOD_CHOICES}
        picked={mood}
        pick={choose(setMood)}
        picture={(choice) => (
          <>
            <MoodFace mood={choice.value} />
            <span className={styles.number}>{choice.value}</span>
          </>
        )}
      />
      <ScoreScale
        legend="How stressed do you feel?"
        hint={scaleHint("stress")}
        choices={STRESS_CHOICES}
        picked={stress}
        pick={choose(setStress)}
        picture={(choice) => <span className={styles.bigNumber}>{choice.value}</span>}
      />
      <div className={styles.submitRow}>
        <button type="submit" className={styles.save} disabled={!ready || pending}>
          {pending ? "Saving…" : saved ? "Saved" : "Save check-in"}
        </button>
        <span role="status" className={result && !result.ok ? styles.error : styles.note}>
          {result && !result.ok ? result.message : saveNote(ready, saved, checkInTime)}
        </span>
      </div>
    </form>
  );
}
