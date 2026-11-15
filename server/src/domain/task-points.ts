// What each kind of task is worth (SPEC §7, owner decision): one setting per kind, so a meal task
// earns its points once however many foods are logged for it. A leaf module, so the task code
// (today-tasks.ts) and the gamification built on it can both import it without a cycle.
import type { ScheduledTaskKind } from "@heartbeat/shared";
import type { RuleSettings, SettingKey } from "./rules/settings.ts";

export const TASK_POINT_SETTINGS = {
  ecg: "points.ecg",
  spo2: "points.spo2",
  checkIn: "points.checkIn",
  meal: "points.meal",
  exercise: "points.exercise",
} as const satisfies Record<ScheduledTaskKind, SettingKey>;

/** Points a task of this kind earns once done; null while its setting is unset (it then earns none). */
export function taskPoints(kind: ScheduledTaskKind, settings: RuleSettings): number | null {
  return settings[TASK_POINT_SETTINGS[kind]];
}
