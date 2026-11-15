// Status presentation over the rules engine's verdict (GET /api/astronauts/:id/status). The web
// app implements NO thresholds: every status, banner, card note and derived value comes from the
// server. Without a status (unrated area, or the status could not be loaded) the neutral
// "no status" look is used.

import type { Area, AstronautStatus, Evaluation, Status } from "@heartbeat/shared";

export type Tone = "ok" | "warn" | "bad" | "neutral";

export interface StatusLook {
  symbol: string;
  label: string;
  tone: Tone;
}

/** The CSS color of each tone, for drawing (charts) where a data-tone attribute cannot be used. */
export const TONE_COLOR: Record<Tone, string> = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--accent)" };

/** Color and symbol for each status (SPEC §9.1), so status never relies on color alone. */
export const STATUS_LOOK: Record<Status, StatusLook> = {
  normal: { symbol: "●", label: "Normal", tone: "ok" },
  watch: { symbol: "▲", label: "Watch", tone: "warn" },
  alert: { symbol: "■", label: "Alert", tone: "bad" },
};

/** Shown while the rules engine has not rated something. */
export const NO_STATUS_LOOK: StatusLook = { symbol: "○", label: "No status", tone: "neutral" };

export function statusLook(status: Status | null): StatusLook {
  return status === null ? NO_STATUS_LOOK : STATUS_LOOK[status];
}

/** How far back the detail page's History reads the alert log (the web's own window, sent as from/to). */
export const ALERT_HISTORY_DAYS = 7;

const SEVERITY: Record<Status, number> = { normal: 0, watch: 1, alert: 2 };

/** An area's status from the server; null when there is no status source or the area is unrated. */
export function areaStatus(status: Pick<AstronautStatus, "areas"> | null, area: Area): Status | null {
  return status?.areas.find((entry) => entry.area === area)?.status ?? null;
}

/** The server's reason an area is unrated, when it gives one (decision 15). */
export function areaReason(status: AstronautStatus | null, area: Area): string | null {
  return status?.areas.find((entry) => entry.area === area)?.reason ?? null;
}

/** Active watch and alert evaluations, red above yellow, newest first within each (SPEC §9.1). */
export function attentionItems(status: AstronautStatus | null, area?: Area): Evaluation[] {
  if (!status) return [];
  return status.evaluations
    .filter((evaluation) => (area === undefined || evaluation.area === area) && evaluation.status !== "normal")
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || Date.parse(b.at) - Date.parse(a.at));
}
