const mockPaginate = jest.fn();
const mockListForRepo = jest.fn();
const mockListLabelsForRepo = jest.fn();
const mockGetIssue = jest.fn();
const mockUpdateIssue = jest.fn();
const mockCreateLabel = jest.fn();
const mockAddLabels = jest.fn();
const mockRemoveLabel = jest.fn();
const mockGraphql = jest.fn();

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    paginate: mockPaginate,
    graphql: mockGraphql,
    issues: {
      listForRepo: mockListForRepo,
      listLabelsForRepo: mockListLabelsForRepo,
      get: mockGetIssue,
      update: mockUpdateIssue,
      createLabel: mockCreateLabel,
      addLabels: mockAddLabels,
      removeLabel: mockRemoveLabel,
    },
  })),
}));

import {
  displayStatusFromIssue,
  listIssuesAcrossRepos,
  mapWithConcurrency,
  normalizeGitHubRepo,
  priorityFromLabels,
  projectStatusOptionFor,
  updateGitHubIssueLabel,
  updateGitHubIssueStatus,
} from "@/lib/github-issue-link";

describe("github-issue-link", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["example/service", "example/service"],
    ["https://github.com/example/service", "example/service"],
    ["https://github.com/example/service.git?tab=readme", "example/service"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeGitHubRepo(input)).toBe(expected);
  });

  it("rejects a repository reference with an unexpected path", () => {
    expect(() => normalizeGitHubRepo("example/service/issues/42")).toThrow(
      "Invalid GitHub repository reference",
    );
  });

  it("maps upstream labels deterministically", () => {
    expect(priorityFromLabels(["P0"])).toBe("critical");
    expect(priorityFromLabels(["priority:high"])).toBe("high");
    expect(priorityFromLabels(["unrelated"])).toBeNull();
    expect(displayStatusFromIssue("open", ["status:in-progress"])).toBe(
      "in_progress",
    );
    expect(displayStatusFromIssue("closed", ["status:in-progress"])).toBe(
      "resolved",
    );
  });

  it("adds one label without replacing existing GitHub labels", async () => {
    mockAddLabels.mockResolvedValue({ data: [] });
    mockGetIssue.mockResolvedValue({
      data: {
        number: 42,
        title: "Tracked issue",
        body: null,
        html_url: "https://github.com/example/service/issues/42",
        state: "open",
        labels: [{ name: "bug" }, { name: "tome-tracker" }],
        assignees: [],
        user: { login: "test-user" },
        milestone: null,
      },
    });

    const issue = await updateGitHubIssueLabel(
      "token",
      "example/service",
      42,
      "tome-tracker",
      "add",
    );

    expect(mockAddLabels).toHaveBeenCalledWith({
      owner: "example",
      repo: "service",
      issue_number: 42,
      labels: ["tome-tracker"],
    });
    expect(mockUpdateIssue).not.toHaveBeenCalled();
    expect(issue.labels).toEqual(["bug", "tome-tracker"]);
  });

  it("removes one label and returns the refreshed issue", async () => {
    mockRemoveLabel.mockResolvedValue({ data: [] });
    mockGetIssue.mockResolvedValue({
      data: {
        number: 42,
        title: "Tracked issue",
        body: null,
        html_url: "https://github.com/example/service/issues/42",
        state: "open",
        labels: [{ name: "bug" }],
        assignees: [],
        user: { login: "test-user" },
        milestone: null,
      },
    });

    const issue = await updateGitHubIssueLabel(
      "token",
      "example/service",
      42,
      "tome-tracker",
      "remove",
    );

    expect(mockRemoveLabel).toHaveBeenCalledWith({
      owner: "example",
      repo: "service",
      issue_number: 42,
      name: "tome-tracker",
    });
    expect(issue.labels).toEqual(["bug"]);
  });

  it("bounds concurrent GitHub reads while preserving order", async () => {
    let active = 0;
    let peak = 0;
    const values = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return value * 2;
      },
    );
    expect(values).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("paginates every repository issue while excluding pull requests", async () => {
    mockPaginate.mockResolvedValue([
      {
        number: 42,
        title: "Issue",
        body: "Body",
        html_url: "https://github.com/example/service/issues/42",
        state: "open",
        labels: [{ name: "bug" }],
        assignees: [{ login: "test-user" }],
        user: { login: "issue-author" },
        milestone: { title: "v1" },
      },
      {
        number: 41,
        title: "Pull request",
        html_url: "https://github.com/example/service/pull/41",
        state: "open",
        pull_request: { url: "https://api.github.com/example" },
      },
    ]);

    const issues = await listIssuesAcrossRepos(
      "token",
      ["example/service"],
      { refresh: true },
    );

    expect(mockPaginate).toHaveBeenCalledWith(mockListForRepo, {
      owner: "example",
      repo: "service",
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    expect(issues).toEqual([
      expect.objectContaining({
        repo: "example/service",
        number: 42,
        author: "issue-author",
        milestone: "v1",
      }),
    ]);
  });

  it("does not retain an in-process issue-list cache", async () => {
    mockPaginate.mockResolvedValue([]);

    await Promise.all([
      listIssuesAcrossRepos("another-token", ["example/service"], {
        refresh: true,
      }),
      listIssuesAcrossRepos("another-token", ["example/service"], {
        refresh: true,
      }),
    ]);

    expect(mockPaginate).toHaveBeenCalledTimes(2);
  });

  it("moves an open issue into progress using the repository's existing label", async () => {
    mockGetIssue.mockResolvedValue({
      data: {
        number: 42,
        title: "Issue",
        body: "Body",
        html_url: "https://github.com/example/service/issues/42",
        state: "open",
        labels: [{ name: "bug" }],
      },
    });
    mockPaginate.mockResolvedValue([{ name: "in-progress" }]);
    mockUpdateIssue.mockResolvedValue({
      data: {
        number: 42,
        title: "Issue",
        body: "Body",
        html_url: "https://github.com/example/service/issues/42",
        state: "open",
        labels: [{ name: "bug" }, { name: "in-progress" }],
      },
    });

    await expect(
      updateGitHubIssueStatus(
        "status-token",
        "example/service",
        42,
        "in_progress",
      ),
    ).resolves.toMatchObject({
      issue: {
        repo: "example/service",
        number: 42,
        displayStatus: "in_progress",
        labels: ["bug", "in-progress"],
      },
      projectStatus: { linkedProjectCount: 0 },
    });
    expect(mockPaginate).toHaveBeenCalledWith(mockListLabelsForRepo, {
      owner: "example",
      repo: "service",
      per_page: 100,
    });
    expect(mockUpdateIssue).toHaveBeenCalledWith({
      owner: "example",
      repo: "service",
      issue_number: 42,
      state: "open",
      labels: ["bug", "in-progress"],
    });
    expect(mockCreateLabel).not.toHaveBeenCalled();
  });

  it("closes a resolved issue and removes only workflow status labels", async () => {
    mockGetIssue.mockResolvedValue({
      data: {
        number: 7,
        title: "Issue",
        html_url: "https://github.com/example/service/issues/7",
        state: "open",
        labels: ["bug", "status:in-progress"],
      },
    });
    mockUpdateIssue.mockResolvedValue({
      data: {
        number: 7,
        title: "Issue",
        html_url: "https://github.com/example/service/issues/7",
        state: "closed",
        state_reason: "completed",
        labels: ["bug"],
      },
    });

    await expect(
      updateGitHubIssueStatus(
        "resolved-token",
        "example/service",
        7,
        "resolved",
      ),
    ).resolves.toMatchObject({
      issue: {
        displayStatus: "resolved",
        state: "closed",
        labels: ["bug"],
      },
    });
    expect(mockUpdateIssue).toHaveBeenCalledWith({
      owner: "example",
      repo: "service",
      issue_number: 7,
      state: "closed",
      state_reason: "completed",
      labels: ["bug"],
    });
  });

  it("rejects a write token when GitHub silently drops the requested label", async () => {
    mockGetIssue.mockResolvedValue({
      data: {
        number: 8,
        title: "Issue",
        html_url: "https://github.com/example/service/issues/8",
        state: "open",
        labels: ["bug"],
      },
    });
    mockPaginate.mockResolvedValue([{ name: "in-progress" }]);
    mockUpdateIssue.mockResolvedValue({
      data: {
        number: 8,
        title: "Issue",
        html_url: "https://github.com/example/service/issues/8",
        state: "open",
        labels: ["bug"],
      },
    });

    await expect(
      updateGitHubIssueStatus(
        "read-only-token",
        "example/service",
        8,
        "in_progress",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("updates every linked GitHub Project status using its matching option", async () => {
    mockGetIssue.mockResolvedValue({
      data: {
        node_id: "ISSUE_NODE",
        number: 12,
        title: "Project issue",
        html_url: "https://github.com/example/service/issues/12",
        state: "open",
        labels: [{ name: "in-progress" }],
      },
    });
    mockUpdateIssue.mockResolvedValue({
      data: {
        number: 12,
        title: "Project issue",
        html_url: "https://github.com/example/service/issues/12",
        state: "closed",
        state_reason: "completed",
        labels: [],
      },
    });
    mockGraphql
      .mockResolvedValueOnce({
        node: {
          projectItems: {
            nodes: [{
              id: "ITEM_NODE",
              project: {
                id: "PROJECT_NODE",
                title: "Example project",
                url: "https://github.com/orgs/example/projects/1",
                field: {
                  id: "STATUS_FIELD",
                  name: "Status",
                  options: [
                    { id: "TODO_OPTION", name: "Todo" },
                    { id: "DONE_OPTION", name: "Done" },
                  ],
                },
              },
            }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      })
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "ITEM_NODE" } },
      });

    await expect(
      updateGitHubIssueStatus("project-token", "example/service", 12, "resolved"),
    ).resolves.toMatchObject({
      issue: { displayStatus: "resolved" },
      projectStatus: {
        linkedProjectCount: 1,
        updated: [{
          projectId: "PROJECT_NODE",
          projectTitle: "Example project",
          status: "Done",
        }],
        skipped: [],
        failed: [],
      },
    });
    expect(mockGraphql).toHaveBeenLastCalledWith(
      expect.stringContaining("updateProjectV2ItemFieldValue"),
      {
        projectId: "PROJECT_NODE",
        itemId: "ITEM_NODE",
        fieldId: "STATUS_FIELD",
        optionId: "DONE_OPTION",
      },
    );
  });

  it("keeps a successful issue move when the token cannot read linked projects", async () => {
    mockGetIssue.mockResolvedValue({
      data: {
        node_id: "ISSUE_NODE",
        number: 13,
        title: "Scoped issue",
        html_url: "https://github.com/example/service/issues/13",
        state: "open",
        labels: [],
      },
    });
    mockPaginate.mockResolvedValue([{ name: "status:in-progress" }]);
    mockUpdateIssue.mockResolvedValue({
      data: {
        number: 13,
        title: "Scoped issue",
        html_url: "https://github.com/example/service/issues/13",
        state: "open",
        labels: [{ name: "status:in-progress" }],
      },
    });
    mockGraphql.mockRejectedValue(
      new Error("The token requires the read:project scope"),
    );

    await expect(
      updateGitHubIssueStatus(
        "issue-only-token",
        "example/service",
        13,
        "in_progress",
      ),
    ).resolves.toMatchObject({
      issue: { displayStatus: "in_progress" },
      projectStatus: {
        linkedProjectCount: 0,
        updated: [],
        failed: [],
        queryFailed: true,
      },
    });
  });

  it("maps common project workflow names without depending on option order", () => {
    expect(projectStatusOptionFor([
      { id: "backlog", name: "Backlog" },
      { id: "todo", name: "Todo" },
    ], "open")).toEqual({ id: "todo", name: "Todo" });
    expect(projectStatusOptionFor([
      { id: "doing", name: "In-Progress" },
    ], "in_progress")).toEqual({ id: "doing", name: "In-Progress" });
    expect(projectStatusOptionFor([
      { id: "review", name: "Review" },
    ], "resolved")).toBeNull();
  });
});
