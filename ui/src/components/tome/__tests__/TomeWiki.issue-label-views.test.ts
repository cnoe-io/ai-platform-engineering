import {
  DEFAULT_ISSUE_FILTER_VIEWS,
  issueFiltersForLabel,
  migrateLegacyIssueLabelViews,
  reorderIssueFilterViews,
  type IssueFilterView,
} from "@/lib/tome/issue-filter-views";

describe("TOME saved issue view ordering", () => {
  const views: IssueFilterView[] = [
    { id: "decision", title: "Decisions", filters: issueFiltersForLabel("decision") },
    { id: "critical", title: "Critical", filters: issueFiltersForLabel("critical") },
    { id: "bugs", title: "Bugs", filters: issueFiltersForLabel("bug") },
  ];

  it("provides the three fixed label views in product order", () => {
    expect(DEFAULT_ISSUE_FILTER_VIEWS).toMatchObject([
      { id: "tome-tracker", title: "Tome Tracker", filters: { label: "tome-tracker" } },
      { id: "decision", title: "Decisions", filters: { label: "decision" } },
      { id: "critical", title: "Critical", filters: { label: "critical" } },
    ]);
  });

  it("moves a dragged filter view to the dropped position", () => {
    expect(reorderIssueFilterViews(views, "bugs", "decision")).toEqual([
      views[2],
      views[0],
      views[1],
    ]);
  });

  it("matches ids case-insensitively", () => {
    expect(reorderIssueFilterViews(views, "CRITICAL", "BUGS")).toEqual([
      views[0],
      views[2],
      views[1],
    ]);
  });

  it("keeps the same array when the drag cannot change the order", () => {
    expect(reorderIssueFilterViews(views, "missing", "bugs")).toBe(views);
    expect(reorderIssueFilterViews(views, "bugs", "bugs")).toBe(views);
  });

  it("migrates browser-saved label shortcuts into full filter views", () => {
    expect(migrateLegacyIssueLabelViews({
      version: 2,
      custom: [{ label: "bug", title: "Bugs" }],
      order: ["critical", "bug", "decision"],
    })).toMatchObject({
      custom: [{
        id: "bugs",
        title: "Bugs",
        filters: { label: "bug", state: "all", repository: "all" },
      }],
      order: ["critical", "bugs", "decision", "tome-tracker"],
    });
  });
});
