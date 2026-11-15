"use client";

import { useActionState } from "react";
import type { FormAction } from "@/lib/action-result";
import type { DelayOption } from "@/lib/domain/surgeon";
import { ActionFeedback } from "./ActionFeedback";
import styles from "./surgeon.module.css";

interface DelayControlProps {
  options: DelayOption[];
  realTime: boolean;
  change: FormAction;
}

/**
 * The link delay preset (GET/PUT /api/relay/delay, SPEC §8): one button per server preset, and the
 * "real time" toggle that switches the demo scaling off. A change applies to everything sent from then on.
 */
export function DelayControl({ options, realTime, change }: DelayControlProps) {
  const [result, action, pending] = useActionState(change, null);
  return (
    <form action={action} className={styles.delayBlock}>
      <span className={styles.smallLabel} id="delay-label">
        Link delay (one way)
      </span>
      <div role="group" aria-labelledby="delay-label" className={styles.segments}>
        {options.map((option) => (
          <button
            key={option.preset}
            type="submit"
            name="preset"
            value={option.preset}
            aria-pressed={option.selected}
            title={option.description}
            disabled={pending}
            className={styles.segment}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button type="submit" name="realTime" value={String(!realTime)} aria-pressed={realTime} disabled={pending} className={styles.realTime}>
        <span aria-hidden="true">{realTime ? "☑" : "☐"}</span> Real time (no demo scaling)
      </button>
      {result && !result.ok && <ActionFeedback result={result} />}
    </form>
  );
}
