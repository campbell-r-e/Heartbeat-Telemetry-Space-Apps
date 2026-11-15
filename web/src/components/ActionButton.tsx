"use client";

import { useActionState } from "react";
import type { FormAction } from "@/lib/action-result";
import { ActionFeedback } from "./ActionFeedback";
import controls from "./controls.module.css";

interface ActionButtonProps {
  action: FormAction;
  /** Hidden form fields sent with the action. */
  fields: Record<string, string>;
  label: string;
  accessibleLabel: string;
  className: string;
}

/** A one-button form for a server action, with pending state and an inline result message. */
export function ActionButton({ action, fields, label, accessibleLabel, className }: ActionButtonProps) {
  const [result, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={controls.inlineForm}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className} aria-label={accessibleLabel} disabled={pending}>
        {label}
      </button>
      {result && <ActionFeedback result={result} />}
    </form>
  );
}
