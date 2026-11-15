// The one-way communication delay between the spacecraft and the ground (SPEC §8). Pure.
import { DELAY_PRESETS, type DelayPreset, type DelayPresetInfo, type RelayDelayResponse, type RelaySetting } from "@heartbeat/shared";
import { MINUTE_MS } from "../time.ts";

const SECOND_MS = 1000;

/**
 * Each preset's true one-way delay and its demo setting (SPEC §8): the ISS and Moon delays are
 * shown as they are; the Mars delays are scaled down to seconds unless "real time" is on.
 */
const PRESET_DELAYS: Record<DelayPreset, Omit<DelayPresetInfo, "preset">> = {
  iss: { label: "ISS", realDelayMs: 0, demoDelayMs: 0 },
  moon: { label: "Moon", realDelayMs: 1_300, demoDelayMs: 1_300 },
  marsClose: { label: "Mars (close)", realDelayMs: 3 * MINUTE_MS, demoDelayMs: 10 * SECOND_MS },
  marsFar: { label: "Mars (far)", realDelayMs: 22 * MINUTE_MS, demoDelayMs: 30 * SECOND_MS },
};

/** The mission is an ISS demo, so the relay starts on the ISS preset with demo scaling. */
export const DEFAULT_RELAY_SETTING: RelaySetting = { preset: "iss", realTime: false };

export function oneWayDelayMs({ preset, realTime }: RelaySetting): number {
  const delays = PRESET_DELAYS[preset];
  return realTime ? delays.realDelayMs : delays.demoDelayMs;
}

/** The setting with its delay and every preset, so clients show them without typing numbers. */
export function relayDelay(setting: RelaySetting): RelayDelayResponse {
  return {
    ...setting,
    label: PRESET_DELAYS[setting.preset].label,
    oneWayDelayMs: oneWayDelayMs(setting),
    presets: DELAY_PRESETS.map((preset) => ({ preset, ...PRESET_DELAYS[preset] })),
  };
}

/**
 * When an event sent at `sentAtMs` arrives: one delay later, but never before the event sent
 * ahead of it in the same direction (`previousDeliverAtMs`), so a shortened delay cannot make a
 * later event overtake an earlier one (an acknowledgment before its alert, a removal before its
 * addition).
 */
export function deliverAtMs(sentAtMs: number, delayMs: number, previousDeliverAtMs: number | null): number {
  const arrival = sentAtMs + delayMs;
  return previousDeliverAtMs === null ? arrival : Math.max(arrival, previousDeliverAtMs);
}
