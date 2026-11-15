"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import type { FormAction } from "@/lib/action-result";
import { ActionFeedback } from "./ActionFeedback";
import styles from "./surgeon.module.css";

interface AlertActionsProps {
  alertId: string;
  astronautId: string;
  recipient: string;
  canAcknowledge: boolean;
  canResolve: boolean;
  chartsHref: string;
  acknowledge: FormAction;
  resolve: FormAction;
  sendNote: FormAction;
}

/**
 * An open alert's note box and its four actions (SPEC §9.2): Acknowledge · Send note · View full
 * charts · Mark resolved. Each write travels to the crew through the relay.
 */
export function AlertActions(props: AlertActionsProps) {
  const { alertId, astronautId, recipient, canAcknowledge, canResolve, chartsHref } = props;
  const noteFormId = useId();
  const [noteResult, noteAction, notePending] = useActionState(props.sendNote, null);
  const [ackResult, ackAction, ackPending] = useActionState(props.acknowledge, null);
  const [resolveResult, resolveAction, resolvePending] = useActionState(props.resolve, null);

  return (
    <>
      <form id={noteFormId} action={noteAction}>
        <input type="hidden" name="astronautId" value={astronautId} />
        <input type="hidden" name="alertId" value={alertId} />
        <label className={styles.noteLabel}>
          Note to {recipient} (arrives after the link delay)
          <textarea
            name="text"
            rows={2}
            required
            placeholder="e.g. Stay in the shielded area. Recheck dose rate in 30 min."
            className={styles.textarea}
          />
        </label>
      </form>
      <div className={styles.buttonRow}>
        <form action={ackAction}>
          <input type="hidden" name="alertId" value={alertId} />
          <button type="submit" className={`${styles.btn} ${styles.btnAccent}`} disabled={!canAcknowledge || ackPending}>
            Acknowledge
          </button>
        </form>
        <button type="submit" form={noteFormId} className={styles.btn} disabled={notePending}>
          Send note
        </button>
        <Link href={chartsHref} className={styles.btn}>
          View full charts
        </Link>
        <form action={resolveAction} className={styles.pushRight}>
          <input type="hidden" name="alertId" value={alertId} />
          <button type="submit" className={`${styles.btn} ${styles.btnOk}`} disabled={!canResolve || resolvePending}>
            Mark resolved
          </button>
        </form>
      </div>
      {noteResult && <ActionFeedback result={noteResult} />}
      {ackResult && <ActionFeedback result={ackResult} />}
      {resolveResult && <ActionFeedback result={resolveResult} />}
    </>
  );
}
