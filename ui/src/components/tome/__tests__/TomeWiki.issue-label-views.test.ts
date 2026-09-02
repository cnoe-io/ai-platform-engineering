import {
  customTomeTrackerLabel,
  isTomeTrackedIssueLabel,
  TOME_TRACKED_ISSUE_LABELS,
} from "@/lib/tome/issue-filter-views";

describe("TOME tracked issue labels", () => {
  it("uses a fixed product-owned label set", () => {
    expect(TOME_TRACKED_ISSUE_LABELS).toEqual([
      { id: "critical", label: "tome:critical", title: "Critical" },
      { id: "in-progress", label: "tome:in-progress", title: "In Progress" },
      { id: "completed", label: "tome:completed", title: "Completed" },
    ]);
  });

  it("does not treat arbitrary GitHub labels as tracked", () => {
    expect(isTomeTrackedIssueLabel("TOME:CRITICAL")).toBe(true);
    expect(isTomeTrackedIssueLabel("bug")).toBe(false);
  });

  it("reserves the tome prefix for valid custom tracker suffixes", () => {
    expect(customTomeTrackerLabel("security-review")).toBe("tome:security-review");
    expect(customTomeTrackerLabel("tome:security-review")).toBeNull();
    expect(customTomeTrackerLabel("security review")).toBeNull();
  });
});
