// Human-readable <-> cron conversion for the auto-ingest schedule UI (GH
// #437). The UI never asks a user to type raw cron syntax directly — it
// offers "daily"/"weekly" presets that compile to a cron string, with an
// "advanced" escape hatch for anything else. Client-safe (no Mongo/Node
// imports) so it can run in the browser for the next-run preview.
//
// Form state (`hour`/`minute`/`weekday`) is in the BROWSER's local time —
// nobody wants to do UTC math to pick "9am my time". The cron string itself
// is always stored/matched in UTC (the server runs UTC), so the local<->UTC
// conversion happens only at the two boundaries: compiling to cron
// (`scheduleToCron`) and parsing a stored cron back into the form
// (`cronToSchedule`).

import { cronMatches, isValidCron } from "@/lib/rbac/cron";

export type SchedulePreset = "daily" | "weekly" | "advanced";

export interface ScheduleFormState {
  preset: SchedulePreset;
  hour: number; // 0-23, browser-local
  minute: number; // 0-59
  weekday: number; // 0-6 (Sun=0), browser-local, weekly only
  advancedCron: string; // raw cron, always UTC
}

export const DEFAULT_SCHEDULE: ScheduleFormState = {
  preset: "daily",
  hour: 2,
  minute: 0,
  weekday: 1, // Monday
  advancedCron: "",
};

/** Convert a local hour/weekday to their UTC equivalents on some reference day. */
function localToUtc(hour: number, minute: number, weekday: number) {
  const ref = new Date();
  ref.setHours(hour, minute, 0, 0);
  // Land on the target local weekday first so the UTC day-rollover (if any)
  // still maps back to the right UTC weekday.
  const deltaDays = (weekday - ref.getDay() + 7) % 7;
  ref.setDate(ref.getDate() + deltaDays);
  return { hour: ref.getUTCHours(), minute: ref.getUTCMinutes(), weekday: ref.getUTCDay() };
}

function utcToLocal(hour: number, minute: number, weekday: number) {
  const ref = new Date();
  ref.setUTCHours(hour, minute, 0, 0);
  const deltaDays = (weekday - ref.getUTCDay() + 7) % 7;
  ref.setUTCDate(ref.getUTCDate() + deltaDays);
  return { hour: ref.getHours(), minute: ref.getMinutes(), weekday: ref.getDay() };
}

/** Compile a preset form (local time) into the UTC cron string that gets persisted. */
export function scheduleToCron(form: ScheduleFormState): string {
  if (form.preset === "advanced") return form.advancedCron.trim();
  if (form.preset === "weekly") {
    const utc = localToUtc(form.hour, form.minute, form.weekday);
    return `${utc.minute} ${utc.hour} * * ${utc.weekday}`;
  }
  const utc = localToUtc(form.hour, form.minute, 0);
  return `${utc.minute} ${utc.hour} * * *`;
}

/** Parse a stored UTC cron string back into a preset form (local time) for editing.
 * Falls back to "advanced" for anything that doesn't match a known preset
 * shape exactly (never mangles a schedule the UI didn't create). */
export function cronToSchedule(cron: string): ScheduleFormState {
  const fields = cron.trim().split(/\s+/);
  if (fields.length === 5) {
    const [minute, hour, dom, month, dow] = fields;
    if (dom === "*" && month === "*" && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
      if (dow === "*") {
        const local = utcToLocal(Number(hour), Number(minute), 0);
        return { ...DEFAULT_SCHEDULE, preset: "daily", hour: local.hour, minute: local.minute };
      }
      if (/^\d$/.test(dow)) {
        const local = utcToLocal(Number(hour), Number(minute), Number(dow));
        return {
          ...DEFAULT_SCHEDULE,
          preset: "weekly",
          hour: local.hour,
          minute: local.minute,
          weekday: local.weekday,
        };
      }
    }
  }
  return { ...DEFAULT_SCHEDULE, preset: "advanced", advancedCron: cron };
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Plain-English summary in local time, e.g. "Daily at 9:00 AM" / "Weekly on Monday at 9:00 AM". */
export function describeSchedule(form: ScheduleFormState): string {
  const time = new Date();
  time.setHours(form.hour, form.minute, 0, 0);
  const timeLabel = time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (form.preset === "weekly") return `Weekly on ${WEEKDAY_NAMES[form.weekday]} at ${timeLabel}`;
  if (form.preset === "daily") return `Daily at ${timeLabel}`;
  return "Custom schedule";
}

/**
 * Next UTC time the cron expression fires after `from` (exclusive), or null
 * if it's unparseable or nothing matches within a year. Minute-resolution
 * linear scan — cheap enough client-side for a once-per-render preview.
 */
export function nextCronRun(cron: string, from: Date): Date | null {
  if (!isValidCron(cron)) return null;
  const start = new Date(from.getTime());
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const limit = 366 * 24 * 60; // scan at most one year of minutes
  const cursor = new Date(start.getTime());
  for (let i = 0; i < limit; i++) {
    if (cronMatches(cron, cursor)) return new Date(cursor.getTime());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

/** Relative "in 3 days" / "in 2 hours" phrasing for the next-run time. */
export function describeRelativeTime(target: Date, from: Date): string {
  const diffMs = target.getTime() - from.getTime();
  if (diffMs <= 0) return "shortly";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
