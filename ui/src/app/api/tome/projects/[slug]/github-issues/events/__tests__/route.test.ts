/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockReadableRollup = jest.fn();
const mockRollupRepos = jest.fn();
const mockGetRepoSyncs = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/github-issue-scope", () => ({
  readableTomeRollupProjects: (...args: unknown[]) => mockReadableRollup(...args),
  rollupGitHubRepos: (...args: unknown[]) => mockRollupRepos(...args),
}));
jest.mock("@/lib/tome/github-issue-cache", () => ({
  getTomeRepoSyncs: (...args: unknown[]) => mockGetRepoSyncs(...args),
}));

import { GET, _resetIssueSseConnectionsForTest } from "../route";

const requestUrl =
  "http://example.test/api/tome/projects/example-project/github-issues/events";

function syncRow(repo: string, generation: number) {
  return {
    _id: repo,
    cache_generation: generation,
    status: "ready",
    needs_reconciliation: false,
  };
}

describe("TOME GitHub issue event stream", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    _resetIssueSseConnectionsForTest();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-1",
      user: { email: "viewer@example.test" },
    });
    mockReadableRollup.mockResolvedValue([{ slug: "example-project" }]);
    mockRollupRepos.mockReturnValue(["Example/Service"]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("detects a cache generation written by another replica and streams it", async () => {
    mockGetRepoSyncs
      .mockResolvedValueOnce([syncRow("example/service", 4)])
      .mockResolvedValueOnce([syncRow("example/service", 4)])
      .mockResolvedValueOnce([syncRow("example/service", 5)]);

    const response = await GET(
      new NextRequest(requestUrl),
      { params: Promise.resolve({ slug: "example-project" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const connected = decoder.decode((await reader.read()).value);
    expect(connected).toContain("event: connected");
    expect(connected).toContain("example/service");

    await jest.advanceTimersByTimeAsync(2_000);
    expect(mockGetRepoSyncs).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(2_000);
    const update = decoder.decode((await reader.read()).value);
    expect(update).toContain("event: github_issue_updated");
    expect(update).toContain('"example/service":5');
    expect(update).not.toContain("private/other");
    expect(mockGetRepoSyncs).toHaveBeenNthCalledWith(3, ["example/service"]);

    await reader.cancel();
  });

  it("backs off after a transient MongoDB failure and resumes streaming", async () => {
    mockGetRepoSyncs
      .mockResolvedValueOnce([syncRow("example/service", 1)])
      .mockRejectedValueOnce(new Error("temporary database outage"))
      .mockResolvedValueOnce([syncRow("example/service", 2)]);

    const response = await GET(
      new NextRequest(requestUrl),
      { params: Promise.resolve({ slug: "example-project" }) },
    );
    const reader = response.body!.getReader();
    await reader.read();

    await jest.advanceTimersByTimeAsync(2_000);
    expect(mockGetRepoSyncs).toHaveBeenCalledTimes(2);

    // First failure doubles the two-second poll interval.
    await jest.advanceTimersByTimeAsync(4_000);
    const update = new TextDecoder().decode((await reader.read()).value);
    expect(update).toContain("event: github_issue_updated");
    expect(update).toContain('"example/service":2');

    await reader.cancel();
  });
});
