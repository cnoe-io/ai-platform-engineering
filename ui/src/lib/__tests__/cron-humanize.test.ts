import { humanizeCron } from "../cron-humanize";

describe("humanizeCron", () => {
  it("humanizes a fixed time on selected weekdays", () => {
    expect(humanizeCron("41 18 * * 1,3,5,6")).toBe(
      "At 6:41 PM on Mon, Wed, Fri, and Sat"
    );
  });

  it("humanizes step-based minute schedules", () => {
    expect(humanizeCron("*/5 * * * *")).toBe("Every 5 minutes");
  });

  it("humanizes named weekdays", () => {
    expect(humanizeCron("0 9 * * MON")).toBe("At 9:00 AM on Mon");
  });

  it("returns null for complex expressions it cannot safely explain", () => {
    expect(humanizeCron("0 */2 * * MON-FRI")).toBeNull();
  });
});
