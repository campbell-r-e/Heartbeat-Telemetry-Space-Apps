import type { ActionResult } from "@/lib/action-result";
import controls from "./controls.module.css";

/** The result of a server action, announced to screen readers. */
export function ActionFeedback({ result }: { result: ActionResult }) {
  return (
    <p role="status" className={controls.feedback} data-ok={result ? String(result.ok) : undefined}>
      {result?.message}
    </p>
  );
}
