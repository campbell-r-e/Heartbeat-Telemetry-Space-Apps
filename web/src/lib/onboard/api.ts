import "server-only";

// Every call the web app makes to the onboard server (SPEC §10), in one place. Each response is
// checked against its guard (lib/domain/response-guards.ts) as it arrives.

import type { Area, DelayPreset, ExerciseDayRange, GroundAlertState, Metric, NewAstronaut, SeriesRange, SolarStormPress } from "@heartbeat/shared";
import { seriesQuery, windowQuery, type TimeWindow } from "../domain/ranges";
import * as guard from "../domain/response-guards";
import { getJson, sendJson, type Query } from "./http";

const astronautPath = (id: string) => `/api/astronauts/${encodeURIComponent(id)}`;

export const listAstronauts = () => getJson("/api/astronauts", guard.isCrew);

export const getLatest = (ownerId: string) => getJson(`${astronautPath(ownerId)}/latest`, guard.isLatestReadings);

export const getSeries = (ownerId: string, metric: Metric, range: SeriesRange) =>
  getJson(`${astronautPath(ownerId)}/series`, guard.isSeries, seriesQuery(metric, range));

export const getSchedule = (astronautId: string) => getJson(`${astronautPath(astronautId)}/schedule`, guard.isSchedule);

export const getTasksToday = (astronautId: string) => getJson(`${astronautPath(astronautId)}/tasks/today`, guard.isTaskStates);

/** Points since mission day 1, the measurement streak and the badges (SPEC §7). */
export const getPoints = (astronautId: string) => getJson(`${astronautPath(astronautId)}/points`, guard.isPointsSummary);

export const getMenu = () => getJson("/api/menu", guard.isMenu);

export const getMeals = (astronautId: string, window: TimeWindow) =>
  getJson(`${astronautPath(astronautId)}/meals`, guard.isMealLogs, windowQuery(window));

export const addMeal = (astronautId: string, foodId: string) =>
  sendJson("POST", `${astronautPath(astronautId)}/meals`, guard.isMealLog, { foodId });

export const removeMeal = (astronautId: string, mealId: number) =>
  sendJson("DELETE", `${astronautPath(astronautId)}/meals/${mealId}`, guard.isDeleted);

export const getCheckIns = (astronautId: string, window: TimeWindow) =>
  getJson(`${astronautPath(astronautId)}/checkins`, guard.isCheckIns, windowQuery(window));

export const addCheckIn = (astronautId: string, mood: number, stress: number) =>
  sendJson("POST", `${astronautPath(astronautId)}/checkins`, guard.isCheckIn, { mood, stress });

export const removeCheckIn = (astronautId: string, checkInId: number) =>
  sendJson("DELETE", `${astronautPath(astronautId)}/checkins/${checkInId}`, guard.isDeleted);

/** The rules engine's verdict. Any failure, including 404, is an error (decision 16). */
export const getStatus = (astronautId: string) => getJson(`${astronautPath(astronautId)}/status`, guard.isAstronautStatus);

/** Status changes for one area in the window, oldest first. */
export const getAlertLog = (astronautId: string, area: Area, window: TimeWindow) =>
  getJson(`${astronautPath(astronautId)}/alerts`, guard.isAlertLog, { area, ...windowQuery(window) });

export const getMission = () => getJson("/api/mission", guard.isMission);

/** Exercise minutes per UTC day (7 d or since mission day 1), oldest first. */
export const getExerciseDays = (astronautId: string, range: ExerciseDayRange) =>
  getJson(`${astronautPath(astronautId)}/exercise/daily`, guard.isExerciseDays, { range });

/** Every rule setting and the plain-language limits, for display only (never to apply). */
export const getSettings = () => getJson("/api/settings", guard.isSettings);

// ---- The relay (SPEC §8). Writes through the relay answer 202 with the event sent. ----

export const getRelayDelay = () => getJson("/api/relay/delay", guard.isRelayDelay);

export const changeRelayDelay = (change: { preset?: DelayPreset; realTime?: boolean }) =>
  sendJson("PUT", "/api/relay/delay", guard.isRelayDelay, change);

/** Onboard: the surgeon's notes that have reached the astronaut. */
export const getNotes = (astronautId: string) => getJson(`${astronautPath(astronautId)}/notes`, guard.isOnboardNotes);

export const markNoteRead = (astronautId: string, noteId: string) =>
  sendJson("POST", `${astronautPath(astronautId)}/notes/${encodeURIComponent(noteId)}/read`, guard.isRelayEvent);

/** Onboard: the alerts sent to the flight surgeon in the window, for the banner's countdown. */
export const getRelayedAlerts = (astronautId: string, window: TimeWindow) =>
  getJson(`${astronautPath(astronautId)}/relayed-alerts`, guard.isOnboardAlerts, windowQuery(window));

// ---- Mission Control: what has reached the ground through the relay (SPEC §9.2) ----

const groundAstronautPath = (id: string) => `/api/ground/crew/astronauts/${encodeURIComponent(id)}`;

export const getGroundCrew = () => getJson("/api/ground/crew", guard.isGroundCrew);

export const getGroundMission = () => getJson("/api/ground/mission", guard.isGroundMission);

export const getGroundAlerts = (window: TimeWindow) => getJson("/api/ground/alerts", guard.isGroundAlerts, windowQuery(window));

/** Chart data up to now − the one-way delay; `query` names a range or a from/to window, and a bucket. */
export const getGroundSeries = (ownerId: string, metric: Metric, query: Query) =>
  getJson(`/api/ground/astronauts/${encodeURIComponent(ownerId)}/series`, guard.isGroundSeries, { ...query, metric });

/** Check-ins, calories and exercise minutes per day, as the astronaut's last daily log through the relay had them. */
export const getGroundDailyLog = (astronautId: string) =>
  getJson(`/api/ground/astronauts/${encodeURIComponent(astronautId)}/daily-log`, guard.isGroundDailyLog);

export const getGroundNotes = (astronautId?: string) => getJson("/api/ground/notes", guard.isGroundNotes, { astronautId });

const ALERT_ACTION_PATH: Record<Exclude<GroundAlertState, "new">, string> = { acknowledged: "acknowledge", resolved: "resolve" };

export const handleAlert = (alertId: string, state: Exclude<GroundAlertState, "new">) =>
  sendJson("POST", `/api/ground/alerts/${encodeURIComponent(alertId)}/${ALERT_ACTION_PATH[state]}`, guard.isRelayEvent);

export const sendNote = (note: { astronautId: string; text: string; alertId: string | null }) =>
  sendJson("POST", "/api/ground/notes", guard.isRelayEvent, { astronautId: note.astronautId, text: note.text, alertId: note.alertId ?? undefined });

export const addAstronaut = (astronaut: NewAstronaut) => sendJson("POST", "/api/ground/crew/astronauts", guard.isRelayEvent, astronaut);

export const removeAstronaut = (astronautId: string) => sendJson("DELETE", groundAstronautPath(astronautId), guard.isRelayEvent);

export const assignWatch = (astronautId: string, watchId: string) =>
  sendJson("PUT", `${groundAstronautPath(astronautId)}/watch`, guard.isRelayEvent, { watchId });

export const unassignWatch = (astronautId: string) => sendJson("DELETE", `${groundAstronautPath(astronautId)}/watch`, guard.isRelayEvent);

// ---- The demo's labeled simulated solar storm (SPEC §13). It changes the ship's own simulated
// radiation data at once: a demo control, not a message through the relay. ----

const STORM_PATH = "/api/demo/solar-storm";

export const getSolarStorm = () => getJson(STORM_PATH, guard.isSolarStormState);

/** `expectedFactor`: the storm the console shows (null: none); the server answers 409 when it has changed. */
export const startSolarStorm = (press: SolarStormPress) => sendJson("POST", STORM_PATH, guard.isStormStarted, press);

export const clearSolarStorm = () => sendJson("DELETE", STORM_PATH, guard.isStormCleared);
