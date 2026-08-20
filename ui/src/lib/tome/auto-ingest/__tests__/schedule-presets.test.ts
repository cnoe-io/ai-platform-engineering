// Local<->UTC round-trip for the auto-ingest schedule form. The form is
// edited in the browser's local time; the persisted cron is always UTC.
// Node doesn't reliably support switching `process.env.TZ` mid-test, so
// these assert the round-trip invariant (scheduleToCron -> cronToSchedule
// recovers the original local time) under whatever timezone the test
// runner uses, rather than pinning exact UTC cron strings to a specific zone.

import { cronToSchedule, scheduleToCron } from "../schedule-presets";

describe("scheduleToCron / cronToSchedule (local <-> UTC)", () => {
  it("round-trips a daily schedule", () => {
    const form = { preset: "daily" as const, hour: 9, minute: 30, weekday: 1, advancedCron: "" };
    const roundTripped = cronToSchedule(scheduleToCron(form));
    expect(roundTripped).toMatchObject({ preset: "daily", hour: 9, minute: 30 });
  });

  it("round-trips a weekly schedule, including across a UTC day rollover", () => {
    // 23:45 local is close enough to midnight that in most timezones the
    // UTC-equivalent lands on a different calendar day/weekday — exercises
    // the day-rollover math, whichever direction it rolls in this env.
    const form = { preset: "weekly" as const, hour: 23, minute: 45, weekday: 1, advancedCron: "" };
    const cron = scheduleToCron(form);
    const fields = cron.split(" ");
    expect(fields).toHaveLength(5);
    expect(fields[4]).toMatch(/^[0-6]$/); // a single UTC weekday digit, not "*"

    const roundTripped = cronToSchedule(cron);
    expect(roundTripped).toMatchObject({ preset: "weekly", hour: 23, minute: 45, weekday: 1 });
  });

  it("produces a plain daily cron with no day-of-week restriction", () => {
    const cron = scheduleToCron({ preset: "daily", hour: 2, minute: 15, weekday: 3, advancedCron: "" });
    const fields = cron.split(" ");
    expect(fields[2]).toBe("*"); // day-of-month
    expect(fields[3]).toBe("*"); // month
    expect(fields[4]).toBe("*"); // day-of-week — daily ignores `weekday`
  });

  it("passes advanced cron through unchanged", () => {
    expect(scheduleToCron({ preset: "advanced", hour: 0, minute: 0, weekday: 0, advancedCron: "*/15 * * * *" })).toBe(
      "*/15 * * * *",
    );
  });

  it("falls back to advanced for a cron shape the form doesn't produce", () => {
    const parsed = cronToSchedule("*/15 * * * *");
    expect(parsed.preset).toBe("advanced");
    expect(parsed.advancedCron).toBe("*/15 * * * *");
  });
});
