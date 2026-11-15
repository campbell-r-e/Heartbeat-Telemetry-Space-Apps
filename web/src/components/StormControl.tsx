"use client";

import { useActionState } from "react";
import type { FormAction } from "@/lib/action-result";
import type { StormControlModel } from "@/lib/domain/storm";
import { ActionFeedback } from "./ActionFeedback";
import controls from "./controls.module.css";
import styles from "./surgeon.module.css";

/**
 * The demo control for the labeled simulated deep-space solar storm (SPEC §13): the first press
 * brings Radiation to ▲ watch, the second to ■ alert, and "Clear storm" resets it. It acts on the
 * ship's simulated data at once; only the alerts it causes travel the link, with its delay. A press
 * names the storm it saw, so one made from an out-of-date view is refused and the view reloads.
 */
export function StormControl({ model, action }: { model: StormControlModel; action: FormAction }) {
  const [result, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={styles.stormControl} aria-labelledby="storm-title">
      <div className={styles.stormText}>
        <h2 id="storm-title" className={styles.stormTitle}>
          Simulated deep-space solar storm
        </h2>
        <p className={styles.stormNote}>
          Demo control. The storm is simulated data, labeled “simulated” wherever it shows. It changes the ship’s radiation at once; the
          alerts it causes reach the ground after the link delay.
        </p>
        <p className={styles.stormState}>{model.state}</p>
      </div>
      <div className={styles.stormButtons}>
        {/* The storm this view shows: the server refuses a press made from an out-of-date view. */}
        {model.expected !== null && <input type="hidden" name="expectedFactor" value={model.expected} />}
        <button
          type="submit"
          name="step"
          value={model.nextStep ?? ""}
          className={controls.accentButton}
          disabled={pending || model.nextStep === null}
        >
          {model.pressLabel}
        </button>
        <button type="submit" name="clear" value="clear" className={controls.button} disabled={pending || !model.canClear}>
          Clear storm
        </button>
      </div>
      {result && <ActionFeedback result={result} />}
    </form>
  );
}
