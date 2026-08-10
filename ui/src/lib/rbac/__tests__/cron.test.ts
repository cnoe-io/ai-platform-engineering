import { cronMatches, isValidCron } from "../cron";

describe("isValidCron", () => {
  it("accepts common valid expressions", () => {
    expect(isValidCron("0 * * * *")).toBe(true); // hourly
    expect(isValidCron("0 0 * * *")).toBe(true); // daily midnight
    expect(isValidCron("0 */6 * * *")).toBe(true); // every 6 hours
    expect(isValidCron("*/15 * * * *")).toBe(true); // every 15 min
    expect(isValidCron("30 2 1 * *")).toBe(true); // 02:30 on the 1st
    expect(isValidCron("0 9-17 * * 1-5")).toBe(true); // weekday business hours
    expect(isValidCron("0 0,12 * * *")).toBe(true); // lists
    expect(isValidCron("* * * * *")).toBe(true);
  });

  it("tolerates surrounding/uneven whitespace", () => {
    expect(isValidCron("  0   0 * * *  ")).toBe(true);
  });

  it("rejects wrong field counts", () => {
    expect(isValidCron("* * * *")).toBe(false); // 4 fields
    expect(isValidCron("* * * * * *")).toBe(false); // 6 fields (no seconds support)
    expect(isValidCron("")).toBe(false);
    expect(isValidCron(undefined)).toBe(false);
    expect(isValidCron(null)).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(isValidCron("60 * * * *")).toBe(false); // minute max 59
    expect(isValidCron("* 24 * * *")).toBe(false); // hour max 23
    expect(isValidCron("* * 0 * *")).toBe(false); // day-of-month min 1
    expect(isValidCron("* * * 13 *")).toBe(false); // month max 12
    expect(isValidCron("* * * * 7")).toBe(false); // day-of-week max 6
  });

  it("rejects malformed ranges, steps, and tokens", () => {
    expect(isValidCron("5-1 * * * *")).toBe(false); // inverted range
    expect(isValidCron("*/0 * * * *")).toBe(false); // zero step
    expect(isValidCron("*/x * * * *")).toBe(false); // non-numeric step
    expect(isValidCron("a * * * *")).toBe(false); // non-numeric
    expect(isValidCron("1-2-3 * * * *")).toBe(false); // double range
    expect(isValidCron("1,,2 * * * *")).toBe(false); // empty list element
  });
});

describe("cronMatches (UTC)", () => {
  // All Dates below are constructed with Date.UTC(...) so the assertions are
  // independent of the machine's local timezone.
  const at = (y: number, mo: number, d: number, h: number, mi: number) =>
    new Date(Date.UTC(y, mo, d, h, mi));

  it("matches a daily expression only at the exact UTC minute", () => {
    // "0 2 * * *" — 02:00 UTC every day (the user's example).
    expect(cronMatches("0 2 * * *", at(2026, 5, 16, 2, 0))).toBe(true);
    expect(cronMatches("0 2 * * *", at(2026, 5, 16, 2, 1))).toBe(false);
    expect(cronMatches("0 2 * * *", at(2026, 5, 16, 1, 0))).toBe(false);
    expect(cronMatches("0 2 * * *", at(2026, 5, 16, 3, 0))).toBe(false);
  });

  it("matches wildcards and step values", () => {
    expect(cronMatches("* * * * *", at(2026, 0, 1, 0, 0))).toBe(true);
    // every 15 minutes
    expect(cronMatches("*/15 * * * *", at(2026, 0, 1, 9, 0))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 0, 1, 9, 30))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 0, 1, 9, 31))).toBe(false);
    // every 6 hours, on the hour
    expect(cronMatches("0 */6 * * *", at(2026, 0, 1, 12, 0))).toBe(true);
    expect(cronMatches("0 */6 * * *", at(2026, 0, 1, 13, 0))).toBe(false);
  });

  it("matches lists and ranges", () => {
    expect(cronMatches("0 0,12 * * *", at(2026, 0, 1, 12, 0))).toBe(true);
    expect(cronMatches("0 0,12 * * *", at(2026, 0, 1, 6, 0))).toBe(false);
    // weekday business hours: 2026-06-15 is a Monday
    expect(cronMatches("0 9-17 * * 1-5", at(2026, 5, 15, 9, 0))).toBe(true);
    expect(cronMatches("0 9-17 * * 1-5", at(2026, 5, 15, 18, 0))).toBe(false);
  });

  it("applies crontab DOM/DOW OR-semantics", () => {
    // Both restricted: matches if EITHER the 1st OR a Monday.
    // 2026-06-01 is a Monday; 2026-06-08 is a Monday but not the 1st;
    // 2026-07-01 is the 1st but a Wednesday.
    const expr = "0 0 1 * 1";
    expect(cronMatches(expr, at(2026, 5, 1, 0, 0))).toBe(true); // 1st AND Monday
    expect(cronMatches(expr, at(2026, 5, 8, 0, 0))).toBe(true); // Monday only
    expect(cronMatches(expr, at(2026, 6, 1, 0, 0))).toBe(true); // 1st only
    expect(cronMatches(expr, at(2026, 5, 9, 0, 0))).toBe(false); // neither
  });

  it("constrains by the single restricted day field", () => {
    // Only DOW restricted (Sundays): DOM is unconstrained.
    expect(cronMatches("0 0 * * 0", at(2026, 5, 14, 0, 0))).toBe(true); // a Sunday
    expect(cronMatches("0 0 * * 0", at(2026, 5, 15, 0, 0))).toBe(false); // a Monday
    // Only DOM restricted (the 15th): DOW is unconstrained.
    expect(cronMatches("0 0 15 * *", at(2026, 5, 15, 0, 0))).toBe(true);
    expect(cronMatches("0 0 15 * *", at(2026, 5, 16, 0, 0))).toBe(false);
  });

  it("never matches invalid expressions", () => {
    expect(cronMatches("", at(2026, 0, 1, 0, 0))).toBe(false);
    expect(cronMatches(undefined, at(2026, 0, 1, 0, 0))).toBe(false);
    expect(cronMatches("60 * * * *", at(2026, 0, 1, 0, 0))).toBe(false);
    expect(cronMatches("* * * *", at(2026, 0, 1, 0, 0))).toBe(false);
  });
});
