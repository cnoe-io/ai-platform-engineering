import {
  DECISION_STATUSES,
  FM_PRIORITY,
  FM_STATUS,
  FM_TARGET,
  FM_TITLE,
  FM_TYPE,
  ISSUE_STATUSES,
  isTrackedEntity,
  parseFrontmatter,
  serializeFrontmatter,
} from "@/lib/tome/schema";

describe("tracked Tome entities", () => {
  it("defines explicit Issue and Decision lifecycles", () => {
    expect(ISSUE_STATUSES).toEqual(["open", "in_progress", "resolved"]);
    expect(DECISION_STATUSES).toEqual(["proposed", "accepted", "rejected"]);
  });

  it("round-trips priority and cross-project target frontmatter", () => {
    const markdown = serializeFrontmatter(
      {
        [FM_TYPE]: "issue",
        [FM_TITLE]: "Example blocker",
        [FM_STATUS]: "open",
        [FM_PRIORITY]: "critical",
        [FM_TARGET]: "tome://@example-bhag/overview.md",
      },
      "The blocker context.",
    );
    const [frontmatter, body] = parseFrontmatter(markdown);
    expect(isTrackedEntity(frontmatter)).toBe(true);
    expect(frontmatter[FM_PRIORITY]).toBe("critical");
    expect(frontmatter[FM_TARGET]).toBe("tome://@example-bhag/overview.md");
    expect(body.trim()).toBe("The blocker context.");
  });
});
