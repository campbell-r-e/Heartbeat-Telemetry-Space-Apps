// The flight surgeon console (SPEC §9.2), shaped from the ground's data only: what has come down
// through the relay. Statuses, times and delays all come from the server; this module only picks,
// orders and words them for the approved mockup (mockups/surgeon-console.dc.html).

import {
  AREAS, type Area,
  type CrewChange, type FiringStatus, GroundAlert, GroundAlertState, GroundCrewMember, GroundCrewResponse, GroundMissionResponse,
  PendingCrewChange, RelayDelayResponse, Status, WatchInfo,
} from "@heartbeat/shared";
import { AREA_CHARTS, chartSourceKey, type ChartSource } from "./area-charts";
import { AREA_INFO } from "./areas";
import type { ChartData } from "./chart";
import { NO_VALUE, formatAgo, formatCountdown, formatDelay, formatUtcClockSeconds } from "./format";
import { METRIC_DISPLAY, isShownMetric } from "./metrics";
import { STATUS_LOOK, areaStatus, statusLook, type Tone } from "./status";
import { HOUR_MS } from "./time";

export const SURGEON_PATH = "/surgeon";

export function surgeonAstronautPath(astronautId: string): string {
  return `${SURGEON_PATH}/astronauts/${encodeURIComponent(astronautId)}`;
}

// ---- Tabs, filters and the open alert (kept in the URL, so every view is a link) ----

export type ConsoleTab = "alerts" | "crew";
export type AlertFilter = "all" | FiringStatus;

export const CONSOLE_TABS: readonly { id: ConsoleTab; label: string }[] = [
  { id: "alerts", label: "Alerts" },
  { id: "crew", label: "Crew & Watches" },
];

const filterLabel = (status: FiringStatus) => `${STATUS_LOOK[status].symbol} ${STATUS_LOOK[status].label}`;

export const ALERT_FILTERS: readonly { id: AlertFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "alert", label: filterLabel("alert") },
  { id: "watch", label: filterLabel("watch") },
];

export interface ConsoleView {
  tab: ConsoleTab;
  filter: AlertFilter;
  /** The alert whose details are open, or null. */
  open: string | null;
}

const first = (param: string | string[] | undefined) => (Array.isArray(param) ? param[0] : param);

/** The console view named by the page's search params; anything unknown falls back to the default. */
export function parseConsoleView(params: Record<string, string | string[] | undefined>): ConsoleView {
  const tab = CONSOLE_TABS.find((option) => option.id === first(params.tab))?.id ?? "alerts";
  const filter = ALERT_FILTERS.find((option) => option.id === first(params.filter))?.id ?? "all";
  return { tab, filter, open: first(params.open) ?? null };
}

/** The console URL for a view; default values are left out so links stay short. */
export function consoleHref(view: ConsoleView): string {
  const params = new URLSearchParams();
  if (view.tab !== "alerts") params.set("tab", view.tab);
  if (view.filter !== "all") params.set("filter", view.filter);
  if (view.open) params.set("open", view.open);
  const query = params.toString();
  return query ? `${SURGEON_PATH}?${query}` : SURGEON_PATH;
}

// ---- Header ----

/** "Heartbeat ISS Demo · Day 11 · Crew of 1", from the mission's last report through the relay. */
export function missionLine(report: GroundMissionResponse, crewSize: number): string {
  const crew = `Crew of ${crewSize}`;
  if (!report.mission) return `Mission not reported yet · ${crew}`;
  return `${report.mission.name} · Day ${report.mission.missionDay} · ${crew}`;
}

/**
 * The "Data as of" tile: the time on board of the newest status snapshot the ground holds, and how
 * old it is ("01:06:24 UTC · 3 min ago").
 */
export function dataAsOfText(dataAsOf: string | null, nowMs: number): string {
  return dataAsOf ? `${formatUtcClockSeconds(dataAsOf)} UTC · ${formatAgo(nowMs - Date.parse(dataAsOf))}` : NO_VALUE;
}

export interface DelayOption {
  preset: RelayDelayResponse["preset"];
  label: string;
  selected: boolean;
  /** Both of the preset's delays, for the button's tooltip. */
  description: string;
}

/**
 * The link delay preset buttons, in the server's order: its label and the one-way delay the preset
 * gives with the current real-time setting ("Mars (close) · 3 min").
 */
export function delayOptions(relay: RelayDelayResponse): DelayOption[] {
  return relay.presets.map((info) => ({
    preset: info.preset,
    label: `${info.label} · ${formatDelay(relay.realTime ? info.realDelayMs : info.demoDelayMs)}`,
    selected: info.preset === relay.preset,
    description: `${info.label}: ${formatDelay(info.realDelayMs)} real, ${formatDelay(info.demoDelayMs)} demo`,
  }));
}

// ---- Alert feed ----

const ALERT_STATE_TEXT: Record<GroundAlertState, string> = { new: "New", acknowledged: "Acknowledged", resolved: "Resolved" };

/** How far back the feed asks for alerts (sent from/to, so the text below is true). */
export const ALERT_FEED_DAYS = 7;

/** What the feed says when nothing passes the filter. */
export function emptyFeedText(filter: AlertFilter): string {
  const which = filter === "all" ? "alerts" : `${filterLabel(filter)} alerts`;
  return `No ${which} have reached the ground in the last ${ALERT_FEED_DAYS} days.`;
}

/** Alerts that pass the filter, newest arrival first (as in the mockup). */
export function feedAlerts(alerts: readonly GroundAlert[], filter: AlertFilter): GroundAlert[] {
  return alerts
    .filter((alert) => filter === "all" || alert.status === filter)
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
}

/** The Alerts tab's count: every alert not yet resolved. */
export function openAlertCount(alerts: readonly GroundAlert[]): number {
  return alerts.filter((alert) => alert.state !== "resolved").length;
}

export interface AlertCardModel {
  alertId: string;
  astronautId: string;
  status: FiringStatus;
  state: GroundAlertState;
  stateText: string;
  who: string;
  /** Who a note about this alert goes to: the astronaut it is filed under (also for a crew-wide alert). */
  recipient: string;
  title: string;
  times: string;
  what: string;
  told: string;
  canAcknowledge: boolean;
  canResolve: boolean;
  /** A red alert not yet resolved gets the thick red border; a resolved one is dimmed. */
  emphasis: "urgent" | "normal" | "done";
}

/** The astronaut's name; a crew-wide alert (the ship's sensors) is about the whole crew. */
function alertWho(alert: GroundAlert, names: ReadonlyMap<string, string>): string {
  return alert.crewWide ? "Whole crew" : (names.get(alert.astronautId) ?? alert.astronautId);
}

export function alertCard(alert: GroundAlert, names: ReadonlyMap<string, string>): AlertCardModel {
  return {
    alertId: alert.alertId,
    astronautId: alert.astronautId,
    status: alert.status,
    state: alert.state,
    stateText: ALERT_STATE_TEXT[alert.state],
    who: alertWho(alert, names),
    recipient: names.get(alert.astronautId) ?? alert.astronautId,
    title: alert.title,
    times: `Sent ${formatUtcClockSeconds(alert.sentAt)} UTC ship · Received ${formatUtcClockSeconds(alert.receivedAt)} UTC ground · ${formatDelay(alert.lagMs)} delay`,
    what: alert.message?.what ?? NO_VALUE,
    told: alert.message?.do ?? NO_VALUE,
    canAcknowledge: alert.state === "new",
    canResolve: alert.state !== "resolved",
    emphasis: alert.state === "resolved" ? "done" : alert.status === "alert" ? "urgent" : "normal",
  };
}

/** How far back an alert's chart reaches (SPEC §9.2: a 6-hour chart leading up to it). */
export const ALERT_CHART_LOOKBACK_MS = 6 * HOUR_MS;
const LOOKBACK_HOURS = ALERT_CHART_LOOKBACK_MS / HOUR_MS;
/** The alert chart's caption: from the lookback to the alert. */
export const ALERT_CHART_SPAN_TEXT = `−${LOOKBACK_HOURS} h → alert`;
/** Shown in place of the alert chart when nothing had reached the ground for the lookback. */
export const ALERT_CHART_EMPTY_TEXT = `No readings had reached the ground for the ${LOOKBACK_HOURS} hours before this alert.`;
/** Shown in place of the alert chart for a rule that reads several measurements. */
export const ALERT_CHART_SEVERAL_TEXT = "This rule reads several measurements. Open the full charts to see them.";

/** The chart runs on a little past the alert, so the alert's marker sits near the right edge (mockup). */
const ALERT_CHART_TAIL_SHARE = 1 / 14;
/** Averaging bucket for the alert chart, in minutes. */
export const ALERT_CHART_BUCKET_MINUTES = 5;

export function alertChartWindow(alertAt: string): { fromMs: number; toMs: number; alertMs: number } {
  const alertMs = Date.parse(alertAt);
  return { fromMs: alertMs - ALERT_CHART_LOOKBACK_MS, toMs: alertMs + ALERT_CHART_LOOKBACK_MS * ALERT_CHART_TAIL_SHARE, alertMs };
}

/** An alert's chart and where its marker goes. */
export interface AlertChart {
  data: ChartData;
  alertMs: number;
}

export function alertChartLabel(alert: Pick<GroundAlert, "metric">): string | null {
  return alert.metric && isShownMetric(alert.metric) ? METRIC_DISPLAY[alert.metric].label : null;
}

// ---- The astronaut page ("View full charts") ----

export interface GroundChartSpec {
  area: Area;
  title: string;
  source: ChartSource;
}

/**
 * The dashboard's charts (SPEC §9.2 "same charts as the dashboard"), in area order, each once:
 * readings from the ground's series, check-ins, calories and exercise minutes from the daily log.
 */
export function groundChartSpecs(): GroundChartSpec[] {
  const seen = new Set<string>();
  return AREAS.flatMap((area) => {
    const { main, secondary } = AREA_CHARTS[area];
    const specs = [main, ...secondary.flatMap((panel) => (panel.kind === "chart" ? [panel.chart] : []))];
    return specs.flatMap((spec): GroundChartSpec[] => {
      const key = chartSourceKey(spec.source);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ area, title: spec.title, source: spec.source }];
    });
  });
}

// ---- Crew summary (beside the alert feed) ----

export interface AreaChip {
  name: string;
  symbol: string;
  tone: Tone;
}

export interface CrewCardModel {
  astronautId: string;
  name: string;
  status: Status | null;
  areas: AreaChip[];
  watchLine: string;
}

/** "••••4A9F": the last four characters of a watch id, enough to tell watches apart. */
export function maskWatchId(watchId: string): string {
  return `••••${watchId.slice(-4)}`;
}

function contactText(watch: WatchInfo, nowMs: number): string {
  return watch.lastContactAt ? formatAgo(nowMs - Date.parse(watch.lastContactAt)) : "no contact yet";
}

export function batteryText(watch: WatchInfo | null): string {
  return watch?.batteryPct == null ? NO_VALUE : `${watch.batteryPct}%`;
}

/** "Watch ••••4A9F · 2 min ago · 64%", or that no watch is assigned. */
export function watchLine(watch: WatchInfo | null, nowMs: number): string {
  if (!watch) return "No watch assigned";
  const battery = watch.batteryPct == null ? [] : [`${watch.batteryPct}%`];
  return [`Watch ${maskWatchId(watch.watchId)}`, contactText(watch, nowMs), ...battery].join(" · ");
}

/** A watch no one wears: "Watch · ID ••••7C21 · last contact 2 min ago". */
export function spareWatchText(watch: WatchInfo, nowMs: number): string {
  return `Watch · ID ${maskWatchId(watch.watchId)} · last contact ${contactText(watch, nowMs)}`;
}

export function crewCard(member: GroundCrewMember, nowMs: number): CrewCardModel {
  return {
    astronautId: member.astronautId,
    name: member.name,
    status: member.status?.overall ?? null,
    areas: AREA_INFO.map((area) => {
      const look = statusLook(areaStatus(member.status, area.id));
      return { name: area.shortTitle, symbol: look.symbol, tone: look.tone };
    }),
    watchLine: watchLine(member.watch, nowMs),
  };
}

// ---- Crew & Watches tab ----

/** The astronaut a crew change is about. */
export function changeAstronautId(change: CrewChange): string {
  return change.action === "addAstronaut" ? change.astronaut.id : change.astronautId;
}

/** A crew change in words, e.g. "Assign watch ••••4A9F to Astronaut 1". */
export function describeChange(change: CrewChange, names: ReadonlyMap<string, string>): string {
  const name = (id: string) => names.get(id) ?? id;
  switch (change.action) {
    case "addAstronaut":
      return `Add ${change.astronaut.name} (${change.astronaut.id})`;
    case "removeAstronaut":
      return `Remove ${name(change.astronautId)}`;
    case "assignWatch":
      return `Assign watch ${maskWatchId(change.watchId)} to ${name(change.astronautId)}`;
    case "unassignWatch":
      return `Unassign ${name(change.astronautId)}'s watch`;
  }
}

export interface SyncBadge {
  text: string;
  tone: Tone;
}

/**
 * A row's sync state: "Synced", or a change on its way ("Sending · 1:12 left" until it reaches the
 * spacecraft, then "Confirming" until the roster that confirms it comes back).
 */
export function syncBadge(pending: Pick<PendingCrewChange, "arrivesOnboardAt"> | null, nowMs: number): SyncBadge {
  if (!pending) return { text: "Synced", tone: "ok" };
  const leftMs = Date.parse(pending.arrivesOnboardAt) - nowMs;
  return { text: leftMs > 0 ? `Sending · ${formatCountdown(leftMs)} left` : "Confirming", tone: "warn" };
}

export interface RosterRow {
  astronautId: string;
  name: string;
  watch: WatchInfo | null;
  watchText: string;
  contact: string;
  battery: string;
  /** The newest change on its way for this astronaut, or null when in sync. */
  pending: PendingCrewChange | null;
  /** Only for an astronaut on the roster; one still being added has nothing to change yet. */
  onRoster: boolean;
}

function newestPending(changes: readonly PendingCrewChange[], astronautId: string): PendingCrewChange | null {
  const mine = changes.filter((pending) => changeAstronautId(pending.change) === astronautId);
  // The server lists changes in send order, so of two sent in the same millisecond the later wins.
  return mine.length === 0 ? null : mine.reduce((newest, pending) => (Date.parse(pending.sentAt) >= Date.parse(newest.sentAt) ? pending : newest));
}

/** The crew table: the roster, then astronauts being added (not on the roster until it confirms them). */
export function rosterRows(ground: Pick<GroundCrewResponse, "crew" | "pendingChanges">, nowMs: number): RosterRow[] {
  const onRoster = ground.crew.map((member): RosterRow => ({
    astronautId: member.astronautId,
    name: member.name,
    watch: member.watch,
    watchText: member.watch ? maskWatchId(member.watch.watchId) : "No watch",
    contact: member.watch ? contactText(member.watch, nowMs) : NO_VALUE,
    battery: batteryText(member.watch),
    pending: newestPending(ground.pendingChanges, member.astronautId),
    onRoster: true,
  }));
  const rosterIds = new Set(ground.crew.map((member) => member.astronautId));
  // One row per id not on the roster, and only while its newest change on the way adds them (an
  // add, a removal and an add again within one delay is still one astronaut).
  const offRosterIds = [...new Set(ground.pendingChanges.map((pending) => changeAstronautId(pending.change)))].filter((id) => !rosterIds.has(id));
  const beingAdded = offRosterIds.flatMap((astronautId): RosterRow[] => {
    const pending = newestPending(ground.pendingChanges, astronautId);
    if (pending?.change.action !== "addAstronaut") return [];
    return [{
      astronautId,
      name: pending.change.astronaut.name,
      watch: null,
      watchText: "No watch",
      contact: NO_VALUE,
      battery: NO_VALUE,
      pending,
      onRoster: false,
    }];
  });
  return [...onRoster, ...beingAdded];
}

/** Every watch the ground knows of except the astronaut's own, for "Reassign watch". */
export function otherWatches(ground: Pick<GroundCrewResponse, "crew" | "unassignedWatches">, astronautId: string): WatchInfo[] {
  const worn = ground.crew.filter((member) => member.astronautId !== astronautId).flatMap((member) => (member.watch ? [member.watch] : []));
  return [...ground.unassignedWatches, ...worn];
}

export function crewNames(crew: readonly { astronautId: string; name: string }[]): Map<string, string> {
  return new Map(crew.map((member) => [member.astronautId, member.name]));
}
