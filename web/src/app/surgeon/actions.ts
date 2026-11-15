"use server";

// Writes from the flight surgeon console (SPEC §9.2). Each one travels to the spacecraft through
// the relay (the server answers 202 with the event sent), except the demo storm control below, which
// acts on the ship at once (200). They run on the Next.js server, which adds the write token
// (SPEC §10). Pages pass these to components as props.

import { refresh } from "next/cache";
import { DELAY_PRESETS, DEMO_STORM_STEPS, type GroundAlertState, type Sex } from "@heartbeat/shared";
import { failed, rejectionResult, succeeded, type ActionResult } from "@/lib/action-result";
import { parseChoice, parseId, parseOptionalId, parseOptionalNumber, parseText } from "@/lib/domain/form-fields";
import { parseExpectedFactor, parseStormStep } from "@/lib/domain/storm";
import * as api from "@/lib/onboard/api";

async function write(run: () => Promise<unknown>, success: string): Promise<ActionResult> {
  try {
    await run();
  } catch (error) {
    return rejectionResult(error);
  }
  refresh();
  return succeeded(success);
}

const SEXES: readonly Sex[] = ["male", "female"];
const BOOLEAN_TEXT = ["true", "false"] as const;

export async function changeDelayAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const preset = parseChoice(form.get("preset"), DELAY_PRESETS);
  const realTime = parseChoice(form.get("realTime"), BOOLEAN_TEXT);
  if (!preset && !realTime) return failed("Choose a delay preset.");
  const change = { ...(preset ? { preset } : {}), ...(realTime ? { realTime: realTime === "true" } : {}) };
  return write(() => api.changeRelayDelay(change), "Link delay changed. It applies to everything sent from now on.");
}

async function alertAction(form: FormData, state: Exclude<GroundAlertState, "new">, success: string): Promise<ActionResult> {
  const alertId = parseId(form.get("alertId"));
  if (!alertId) return failed("That alert could not be found.");
  return write(() => api.handleAlert(alertId, state), success);
}

export async function acknowledgeAlertAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  return alertAction(form, "acknowledged", "Acknowledged. The crew sees it after the link delay.");
}

export async function resolveAlertAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  return alertAction(form, "resolved", "Marked resolved. The crew sees it after the link delay.");
}

export async function sendNoteAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  const text = parseText(form.get("text"));
  const alertLink = parseOptionalId(form.get("alertId"));
  if (!astronautId) return failed("No astronaut chosen for this note.");
  if (!alertLink) return failed("That alert could not be found.");
  const alertId = alertLink.value;
  if (!text) return failed("Write a note first.");
  return write(() => api.sendNote({ astronautId, text, alertId }), "Note sent. It arrives after the link delay.");
}

export async function addAstronautAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const id = parseId(form.get("id"));
  const name = parseText(form.get("name"));
  const age = parseOptionalNumber(form.get("age"));
  const massKg = parseOptionalNumber(form.get("massKg"));
  const heightM = parseOptionalNumber(form.get("heightM"));
  const sex = parseChoice(form.get("sex"), SEXES);
  if (!id) return failed("The id may use letters, digits, “-” and “_” only.");
  if (!name) return failed("Enter a name.");
  if (!age || !massKg || !heightM) return failed("Age, mass and height must be numbers, or left empty.");
  return write(
    () => api.addAstronaut({ id, name, age: age.value, sex, massKg: massKg.value, heightM: heightM.value }),
    `Adding ${name}. The change reaches the spacecraft after the link delay.`,
  );
}

export async function removeAstronautAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  if (!astronautId) return failed("That astronaut could not be found.");
  return write(() => api.removeAstronaut(astronautId), "Removal sent. It takes effect after the link delay.");
}

export async function assignWatchAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  const watchId = parseId(form.get("watchId"));
  if (!astronautId || !watchId) return failed("Choose an astronaut and a watch.");
  return write(() => api.assignWatch(astronautId, watchId), "Watch change sent. It takes effect after the link delay.");
}

// ---- The demo control: the labeled simulated solar storm (SPEC §13, owner decision). It acts on the
// ship's simulated radiation data at once (no relay); the alert it causes travels with the delay. ----

/**
 * The storm control's buttons: "Clear storm" sends `clear`; the main button sends the next `step`
 * and the storm its view showed (`expectedFactor`). The page reloads whatever the answer, so after a
 * refused out-of-date press (409) the control shows the storm as it is now.
 */
export async function stormAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const result = await stormWrite(form);
  refresh();
  return result;
}

async function stormWrite(form: FormData): Promise<ActionResult> {
  if (form.get("clear") !== null) {
    return write(() => api.clearSolarStorm(), "Simulated storm cleared. The ship's radiation is the real ISS record again.");
  }
  const step = parseStormStep(form.get("step"));
  const expectedFactor = parseExpectedFactor(form.get("expectedFactor"));
  if (!step) return failed("Choose a storm step.");
  if (expectedFactor === "invalid") return failed("This storm control is out of date; reload the page.");
  const success = step === "watch"
    ? "Simulated storm started. Radiation turns ▲ watch on board now; the alert reaches the ground after the link delay."
    : "Simulated storm escalated. Radiation turns ■ alert on board now; the alert reaches the ground after the link delay.";
  return write(() => api.startSolarStorm({ factor: DEMO_STORM_STEPS[step], expectedFactor }), success);
}

export async function unassignWatchAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  if (!astronautId) return failed("That astronaut could not be found.");
  return write(() => api.unassignWatch(astronautId), "Unassign sent. It takes effect after the link delay.");
}
