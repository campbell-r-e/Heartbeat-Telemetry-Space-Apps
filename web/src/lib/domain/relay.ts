// How the relay between the spacecraft and Mission Control is shown (SPEC §8, §9). Every time here
// comes from the server's relay data (sentAt, deliverAt, the delay setting); the web app only
// formats it and counts down to it.

import type {
  Evaluation, GroundNote, LiveChannel, LiveMessage, Metric, OnboardAlert, OnboardNote, RelayDelayResponse, RelayEventKind,
} from "@heartbeat/shared";
import { formatCountdown, formatDelay, formatUtcClock } from "./format";

/** The header's "Earth link" tile on the dashboard: the current one-way delay and its preset. */
export function earthLinkTile(relay: RelayDelayResponse): { value: string; detail: string } {
  return {
    value: `${relay.label} · ${formatDelay(relay.oneWayDelayMs)} delay`,
    detail: relay.realTime ? "Real time" : "Demo scale",
  };
}

/**
 * The alert sent to the flight surgeon for a red banner: the newest relayed 🔴 of the same rule that
 * belongs to the banner's astronaut (or is crew-wide). Null when none was sent, so no banner ever
 * claims an alert went out.
 */
export function relayedAlertFor(evaluation: Evaluation, alerts: readonly OnboardAlert[]): OnboardAlert | null {
  if (evaluation.status !== "alert") return null;
  const matches = alerts.filter(
    (alert) => alert.status === "alert" && alert.ruleId === evaluation.ruleId && (alert.crewWide || alert.astronautId === evaluation.astronautId),
  );
  return matches.reduce<OnboardAlert | null>((newest, alert) => (newest === null || Date.parse(alert.sentAt) > Date.parse(newest.sentAt) ? alert : newest), null);
}

/** The red banner's tag (SPEC §9.1): counting down to the alert's arrival, then what became of it. */
export function bannerRelayText(alert: Pick<OnboardAlert, "deliverAt" | "handling">, nowMs: number): string {
  if (alert.handling) return `Flight surgeon ${alert.handling.state} · ${formatUtcClock(alert.handling.at)} UTC`;
  const leftMs = Date.parse(alert.deliverAt) - nowMs;
  if (leftMs > 0) return `Alert sent to flight surgeon · arrives in ${formatCountdown(leftMs)}`;
  return `Alert sent to flight surgeon · arrived ${formatUtcClock(alert.deliverAt)} UTC`;
}

/** A surgeon's note as the ground knows it: on its way, delivered, or read (the read receipt). */
export function groundNoteText(note: Pick<GroundNote, "deliverAt" | "readAt">, nowMs: number): string {
  if (note.readAt) return `Read ${formatUtcClock(note.readAt)} UTC`;
  const leftMs = Date.parse(note.deliverAt) - nowMs;
  if (leftMs > 0) return `Sending · ${formatCountdown(leftMs)} left`;
  return `Delivered ${formatUtcClock(note.deliverAt)} UTC · not read yet`;
}

/** The surgeon's notes, newest first. */
export function notesNewestFirst<T extends Pick<GroundNote, "sentAt">>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
}

/** A note on the astronaut's dashboard: when it left the ground and when it arrived. */
export function onboardNoteText(note: Pick<OnboardNote, "sentAt" | "receivedAt">): string {
  return `Sent from Earth ${formatUtcClock(note.sentAt)} UTC · Received ${formatUtcClock(note.receivedAt)} UTC`;
}

/** How many dashboard notes stay listed once read; unread ones are always listed. */
export const READ_NOTES_SHOWN = 3;

/** Unread notes first, then the newest few read ones; newest first within each. */
export function notesToShow(notes: readonly OnboardNote[]): OnboardNote[] {
  const newestFirst = [...notes].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return [...newestFirst.filter((note) => !note.readAt), ...newestFirst.filter((note) => note.readAt).slice(0, READ_NOTES_SHOWN)];
}

/** The measurements the astronaut starts on the watch (SPEC §9.3), each shown as soon as it is uploaded. */
const ON_DEMAND_METRICS: readonly Metric[] = ["ecg", "spo2"];

/**
 * The relay events that change what each page shows. The dashboard leaves out its own status
 * snapshots, which every status request can send, so loading the page never triggers a reload.
 */
const REFRESHING_KINDS: Record<LiveChannel, { sent: readonly RelayEventKind[]; delivered: readonly RelayEventKind[] }> = {
  onboard: { sent: ["alert", "readReceipt"], delivered: ["note", "alertState", "crewChange"] },
  ground: {
    sent: ["note", "alertState", "crewChange"],
    delivered: ["status", "alert", "readReceipt", "roster", "mission", "dailyLog", "deliveryFailure"],
  },
};

/**
 * Whether a live message should reload the page's server data. `astronautId` is the astronaut whose
 * points the page shows: only their `points` messages reload it, and a page that shows no points
 * (null, e.g. the area detail pages) never reloads on one.
 */
export function shouldRefresh(channel: LiveChannel, message: LiveMessage, astronautId: string | null = null): boolean {
  switch (message.type) {
    case "relayDelay":
      return true;
    // A task became done or undone (or a new day began): points, streak and tasks change (SPEC §7).
    case "points":
      return channel === "onboard" && astronautId !== null && message.points.astronautId === astronautId;
    case "relaySent":
      return REFRESHING_KINDS[channel].sent.includes(message.event.kind);
    case "relayDelivered":
      return REFRESHING_KINDS[channel].delivered.includes(message.event.kind);
    // An ECG or SpO₂ the shown astronaut just took appears within seconds on the dashboard (demo
    // step 2), filtered by astronaut like points. Other readings arrive every minute and wait for
    // the page's regular refresh, as do pages that name no astronaut.
    case "readings":
      return channel === "onboard" && astronautId !== null && message.astronautId === astronautId
        && message.metrics.some((metric) => ON_DEMAND_METRICS.includes(metric));
    default:
      return false;
  }
}
