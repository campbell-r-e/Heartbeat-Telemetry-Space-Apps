// The daily task schedule behind reminders and the dashboard's "Today's tasks" (SPEC §7). This is
// the owner's configuration, written to the database on every start (replacing what is there) so
// the watch and dashboard read one copy that always matches this list.
import type { ScheduledTask } from "@heartbeat/shared";

/** HH:MM on a 24-hour clock, spacecraft local time, which is UTC (the ISS keeps UTC; SPEC §7). */
export const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The owner's schedule. astronautId null = every astronaut. */
export const DEFAULT_SCHEDULE: readonly ScheduledTask[] = [
  { id: "meal-0800", kind: "meal", label: "Breakfast", localTime: "08:00", astronautId: null },
  { id: "ecg-0900", kind: "ecg", label: "ECG", localTime: "09:00", astronautId: null },
  { id: "spo2-0900", kind: "spo2", label: "Blood oxygen", localTime: "09:00", astronautId: null },
  { id: "meal-1300", kind: "meal", label: "Lunch", localTime: "13:00", astronautId: null },
  { id: "meal-1900", kind: "meal", label: "Dinner", localTime: "19:00", astronautId: null },
  { id: "checkin-2000", kind: "checkIn", label: "Mood check-in", localTime: "20:00", astronautId: null },
  { id: "spo2-2100", kind: "spo2", label: "Blood oxygen", localTime: "21:00", astronautId: null },
  // No set time: done once today's exercise minutes reach the daily goal (owner decision).
  { id: "exercise-daily", kind: "exercise", label: "Exercise", localTime: null, astronautId: null },
];
