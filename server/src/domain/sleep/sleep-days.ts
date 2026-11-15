// The days live sleep detection analyzes (SPEC §5.7): each runs from noon to noon on the wall clock
// of the mission's sleep-day time zone, an IANA zone name ("UTC" in flight, owner decision).
//
// van Hees et al. 2018 (Sci Rep 8, 12975), "Heuristic algorithm to detect the SPT-window": the
// threshold and the longest block are taken "over an individual day (noon-noon)". The paper's
// implementation, GGIR, places that day by the local clock of its `desiredtz` time-zone argument
// (GGIR 1.5-23, R/g.sib.det.R: local midnights from g.detecmidnight(time, desiredtz), the day then
// running 12 hours either side). Here both noons are read on the zone's wall clock (owner decision),
// so a day that changes to or from daylight time lasts 23 or 25 hours. Only the day boundaries use
// the zone; every time stored or shown stays in UTC.
import { DAY_MS } from "../time.ts";
import { localDate, wallTimeToUtcMs } from "../zoned-time.ts";

/** One noon-to-noon day, [startMs, endMs) in UTC ms; 23, 24 or 25 hours long. */
export interface AnalysisDay {
  startMs: number;
  endMs: number;
}

/** The noon-to-noon days of one time zone. */
export interface SleepDays {
  /** The day containing `ms`. */
  containing(ms: number): AnalysisDay;
  /** The day a waking time belongs to: wakes fall in (start, end], since a window can run to the day's last epoch. */
  ofWake(wakeMs: number): AnalysisDay;
  /** The `count` most recent days that have ended by `nowMs`, newest first. */
  ended(nowMs: number, count: number): AnalysisDay[];
}

const NOON_MINUTE = 12 * 60;

/** The noon-to-noon days of `timeZone`, an IANA zone name such as "UTC" or "America/Indiana/Indianapolis". */
export function sleepDays(timeZone: string): SleepDays {
  const noonOn = (date: string) => wallTimeToUtcMs({ date, minuteOfDay: NOON_MINUTE }, timeZone);
  const dayFrom = (startDate: string): AnalysisDay => ({ startMs: noonOn(startDate), endMs: noonOn(nextDate(startDate)) });

  const containing = (ms: number): AnalysisDay => {
    const date = localDate(ms, timeZone);
    return dayFrom(ms >= noonOn(date) ? date : previousDate(date));
  };

  return {
    containing,
    ofWake: (wakeMs) => containing(wakeMs - 1),
    ended(nowMs, count) {
      const days: AnalysisDay[] = [];
      for (let day = containing(nowMs); days.length < count; ) {
        day = containing(day.startMs - 1);
        days.push(day);
      }
      return days;
    },
  };
}

/**
 * The times a day's sleep reading can be stamped at, as [fromMs, toMs) for the readings store: a
 * waking time is after the day's start and at most its end.
 */
export function wakeTimesOf(day: AnalysisDay): { fromMs: number; toMs: number } {
  return { fromMs: day.startMs + 1, toMs: day.endMs + 1 };
}

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const nextDate = (date: string) => shiftDate(date, 1);
const previousDate = (date: string) => shiftDate(date, -1);
