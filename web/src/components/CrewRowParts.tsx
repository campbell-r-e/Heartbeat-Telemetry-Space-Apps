"use client";

import { useActionState, useState } from "react";
import type { FormAction } from "@/lib/action-result";
import { ActionFeedback } from "./ActionFeedback";
import { syncBadge } from "@/lib/domain/surgeon";
import styles from "./surgeon.module.css";
import { useNow } from "./useNow";

/** "Synced", or a crew change on its way: counting down to the server's arrivesOnboardAt. */
export function SyncCell({ arrivesOnboardAt, nowMs }: { arrivesOnboardAt: string | null; nowMs: number }) {
  const now = useNow(nowMs);
  const badge = syncBadge(arrivesOnboardAt ? { arrivesOnboardAt } : null, now);
  return (
    <span data-tone={badge.tone} className={styles.sync}>
      {badge.text}
    </span>
  );
}

export interface WatchChoice {
  watchId: string;
  label: string;
}

export interface CrewActionSet {
  assignWatch: FormAction;
  unassignWatch: FormAction;
  removeAstronaut: FormAction;
}

interface RowActionsProps extends CrewActionSet {
  astronautId: string;
  name: string;
  hasWatch: boolean;
  watchChoices: WatchChoice[];
}

/** A crew row's Reassign watch · Unassign · Remove, each sent through the relay. */
export function RowActions({ astronautId, name, hasWatch, watchChoices, assignWatch, unassignWatch, removeAstronaut }: RowActionsProps) {
  const [mode, setMode] = useState<"idle" | "reassign" | "remove">("idle");
  /** Back to the row's buttons once a change has been sent. */
  const closingOnSuccess = (action: FormAction): FormAction => async (previous, form) => {
    const result = await action(previous, form);
    if (result?.ok) setMode("idle");
    return result;
  };
  const [assignResult, assignAction, assignPending] = useActionState(closingOnSuccess(assignWatch), null);
  const [unassignResult, unassignAction, unassignPending] = useActionState(unassignWatch, null);
  const [removeResult, removeAction, removePending] = useActionState(closingOnSuccess(removeAstronaut), null);

  return (
    <div className={styles.rowActions}>
      {mode === "reassign" ? (
        <form action={assignAction} className={styles.rowActions}>
          <input type="hidden" name="astronautId" value={astronautId} />
          <label>
            <span className="srOnly">Watch for {name}</span>
            <select name="watchId" required className={styles.smallSelect} defaultValue="">
              <option value="" disabled>
                Choose a watch…
              </option>
              {watchChoices.map((choice) => (
                <option key={choice.watchId} value={choice.watchId}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={styles.smallBtn} disabled={assignPending || watchChoices.length === 0}>
            Assign
          </button>
          <button type="button" className={styles.smallBtn} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </form>
      ) : mode === "remove" ? (
        <form action={removeAction} className={styles.rowActions}>
          <input type="hidden" name="astronautId" value={astronautId} />
          <span className={styles.confirmText}>Remove {name}? Their stored history is kept.</span>
          <button type="submit" className={`${styles.smallBtn} ${styles.smallBtnDanger}`} disabled={removePending}>
            Remove
          </button>
          <button type="button" className={styles.smallBtn} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <button type="button" className={styles.smallBtn} onClick={() => setMode("reassign")} disabled={watchChoices.length === 0} title={watchChoices.length === 0 ? "No other watch has registered yet" : undefined}>
            {hasWatch ? "Reassign watch" : "Assign watch"}
          </button>
          <form action={unassignAction}>
            <input type="hidden" name="astronautId" value={astronautId} />
            <button type="submit" className={styles.smallBtn} disabled={!hasWatch || unassignPending}>
              Unassign
            </button>
          </form>
          <button type="button" className={`${styles.smallBtn} ${styles.smallBtnDanger}`} onClick={() => setMode("remove")}>
            Remove
          </button>
        </>
      )}
      {assignResult && <ActionFeedback result={assignResult} />}
      {unassignResult && <ActionFeedback result={unassignResult} />}
      {removeResult && <ActionFeedback result={removeResult} />}
    </div>
  );
}

/** "Assign to…" for a watch no one wears: pick the astronaut. */
export function AssignWatchForm({ watchId, crew, assignWatch }: { watchId: string; crew: { astronautId: string; name: string }[]; assignWatch: FormAction }) {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState(assignWatch, null);
  if (!open) {
    return (
      <button type="button" className={`${styles.btn} ${styles.btnAccent}`} onClick={() => setOpen(true)} disabled={crew.length === 0}>
        Assign to…
      </button>
    );
  }
  return (
    <form action={action} className={styles.rowActions}>
      <input type="hidden" name="watchId" value={watchId} />
      <label>
        <span className="srOnly">Astronaut</span>
        <select name="astronautId" required className={styles.select} defaultValue="">
          <option value="" disabled>
            Choose an astronaut…
          </option>
          {crew.map((member) => (
            <option key={member.astronautId} value={member.astronautId}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={`${styles.btn} ${styles.btnAccent}`} disabled={pending}>
        Assign
      </button>
      <button type="button" className={styles.btn} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {result && <ActionFeedback result={result} />}
    </form>
  );
}

/** "+ Add astronaut": id and name, and the optional profile the rules use (age, sex, mass, height). */
export function AddAstronautForm({ addAstronaut }: { addAstronaut: FormAction }) {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState(addAstronaut, null);
  return (
    <>
      <button type="button" className={`${styles.btn} ${styles.btnAccent}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        + Add astronaut
      </button>
      {open && (
        <form action={action} className={styles.addForm}>
          <label className={styles.field}>
            Id
            <input name="id" required pattern="[A-Za-z0-9_\-]+" placeholder="a2" className={styles.input} />
          </label>
          <label className={styles.field}>
            Name
            <input name="name" required placeholder="Astronaut 2" className={styles.input} />
          </label>
          <label className={styles.field}>
            Age (years, optional)
            <input name="age" type="number" min={0} step={1} className={styles.input} />
          </label>
          <label className={styles.field}>
            Sex (optional)
            <select name="sex" className={styles.select} defaultValue="">
              <option value="">Not given</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
          <label className={styles.field}>
            Mass (kg, optional)
            <input name="massKg" type="number" min={0} step="any" className={styles.input} />
          </label>
          <label className={styles.field}>
            Height (m, optional)
            <input name="heightM" type="number" min={0} step="any" className={styles.input} />
          </label>
          <button type="submit" className={`${styles.btn} ${styles.btnAccent}`} disabled={pending}>
            Send
          </button>
          {result && <ActionFeedback result={result} />}
        </form>
      )}
    </>
  );
}
