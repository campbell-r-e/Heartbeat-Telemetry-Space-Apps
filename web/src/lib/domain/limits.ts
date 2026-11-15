// The "Limits in use" list (SPEC §6.7): every limit the rules use, as the server words it in
// GET /api/settings `limits`. The web composes label, value and unit; it types no numbers.

import type { Area, AreaLimit, Status } from "@heartbeat/shared";
import { formatNumberUpTo } from "./format";

export interface LimitLine {
  text: string;
  /** The status past the limit, "normal" for a goal, null for a parameter such as a window length. */
  status: Status | null;
}

const LIMIT_MAX_DECIMALS = 2;

/** A limit's value as the server sent it, without trailing zeros ("2.26", "1,000"). */
export function formatLimitValue(value: number): string {
  return formatNumberUpTo(value, LIMIT_MAX_DECIMALS);
}

/** "Blood oxygen, watch below 95 %": the server's label, then its value and unit when it has them. */
export function limitText(limit: AreaLimit): string {
  if (limit.value === undefined) return limit.label;
  return [limit.label, formatLimitValue(limit.value), limit.unit].filter((part) => part !== undefined).join(" ");
}

/** One area's limits, in the server's order. */
export function areaLimits(limits: readonly AreaLimit[], area: Area): LimitLine[] {
  return limits.filter((limit) => limit.area === area).map((limit) => ({ text: limitText(limit), status: limit.status }));
}
