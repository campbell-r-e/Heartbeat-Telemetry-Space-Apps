// The view model of one dashboard card, built from data so all six cards render the same way.

import type { AstronautStatus, Status } from "@heartbeat/shared";
import type { AreaInfo } from "./areas";
import type { ChartData } from "./chart";
import { areaReadouts, readoutLine, type AreaSnapshot, type Readout } from "./readouts";
import { areaReason, areaStatus, attentionItems } from "./status";

/** Card sub-lines: the spec asks for 2–3 secondary readings (SPEC §9.1). */
export const CARD_SECONDARY_COUNT = 3;

export interface CardModel {
  area: AreaInfo;
  status: Status | null;
  /** The server's reason for "No status", when it gives one (decision 15). */
  statusReason: string | null;
  headline: Readout;
  secondaries: string[];
  chart: ChartData;
  /** One line: the top alert or watch when there is one, else when/where the value came from. */
  note: string;
}

const NO_READINGS_NOTE = "No readings yet.";

export function buildCardModel(area: AreaInfo, snapshot: AreaSnapshot, status: AstronautStatus | null, chart: ChartData): CardModel {
  const readouts = areaReadouts(area.id, snapshot);
  const [topItem] = attentionItems(status, area.id);
  const cardStatus = areaStatus(status, area.id);
  return {
    area,
    status: cardStatus,
    statusReason: cardStatus === null ? areaReason(status, area.id) : null,
    headline: readouts.headline,
    secondaries: readouts.details.slice(0, CARD_SECONDARY_COUNT).map(readoutLine),
    chart,
    note: topItem ? `${topItem.title}: ${topItem.message.what}` : (readouts.provenance ?? NO_READINGS_NOTE),
  };
}
