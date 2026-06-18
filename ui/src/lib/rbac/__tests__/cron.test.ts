import { isValidCron } from "../cron";

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
