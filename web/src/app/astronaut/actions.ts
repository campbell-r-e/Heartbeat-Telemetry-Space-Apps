"use server";

// Writes from the dashboard. They run on the Next.js server, which adds the onboard server's
// write token (SPEC §10); the browser never sees it. Pages pass these to components as props.

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { failed, rejectionResult, succeeded, type ActionResult } from "@/lib/action-result";
import { CREW_COOKIE, CREW_COOKIE_MAX_AGE_S } from "@/lib/crew-choice";
import { parseScore } from "@/lib/domain/checkin";
import { parseId, parsePositiveInt } from "@/lib/domain/form-fields";
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

export async function addMealAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  const foodId = parseId(form.get("foodId"));
  if (!astronautId || !foodId) return failed("That menu item could not be added.");
  return write(() => api.addMeal(astronautId, foodId), "Meal logged.");
}

export async function removeMealAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  const mealId = parsePositiveInt(form.get("mealId"));
  if (!astronautId || mealId === null) return failed("That meal could not be removed.");
  return write(() => api.removeMeal(astronautId, mealId), "Meal removed.");
}

export async function submitCheckInAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  const mood = parseScore(form.get("mood"));
  const stress = parseScore(form.get("stress"));
  if (!astronautId) return failed("No astronaut selected.");
  if (mood === null || stress === null) return failed("Choose both a mood and a stress level.");
  return write(() => api.addCheckIn(astronautId, mood, stress), "Sent to the onboard server.");
}

export async function removeCheckInAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  const checkInId = parsePositiveInt(form.get("checkInId"));
  if (!astronautId || checkInId === null) return failed("That check-in could not be removed.");
  return write(() => api.removeCheckIn(astronautId, checkInId), "Check-in removed.");
}

/** Marks a note from the flight surgeon read; the read receipt travels to the ground (SPEC §8). */
export async function markNoteReadAction(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const astronautId = parseId(form.get("astronautId"));
  const noteId = parseId(form.get("noteId"));
  if (!astronautId || !noteId) return failed("That note could not be marked read.");
  return write(() => api.markNoteRead(astronautId, noteId), "Marked read. The flight surgeon sees it after the link delay.");
}

/** Remembers the crew member this browser shows (decision 13). */
export async function chooseAstronautAction(astronautId: string): Promise<void> {
  const id = parseId(astronautId);
  if (!id) return;
  (await cookies()).set(CREW_COOKIE, id, { path: "/", maxAge: CREW_COOKIE_MAX_AGE_S, sameSite: "lax" });
}
