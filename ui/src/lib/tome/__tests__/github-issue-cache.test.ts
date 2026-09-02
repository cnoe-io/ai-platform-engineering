/** @jest-environment node */

const mockListIssues = jest.fn();
const mockListDiscussions = jest.fn();
const mockIssueFind = jest.fn();
const mockIssueBulkWrite = jest.fn();
const mockIssueDeleteMany = jest.fn();
const mockIssueFindOne = jest.fn();
const mockIssueReplaceOne = jest.fn();
const mockSyncFind = jest.fn();
const mockSyncFindOne = jest.fn();
const mockSyncFindOneAndUpdate = jest.fn();
const mockSyncUpdateOne = jest.fn();

jest.mock("@/lib/github-issue-link", () => ({
  listIssuesAcrossRepos: (...args: unknown[]) => mockListIssues(...args),
  normalizeGitHubRepo: (value: string) =>
    value.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""),
}));
jest.mock("@/lib/github-discussion-link", () => ({
  listDiscussionsAcrossRepos: (...args: unknown[]) =>
    mockListDiscussions(...args),
}));
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) =>
    name === "tome_github_issues"
      ? {
          find: (...args: unknown[]) => mockIssueFind(...args),
          bulkWrite: (...args: unknown[]) => mockIssueBulkWrite(...args),
          deleteMany: (...args: unknown[]) => mockIssueDeleteMany(...args),
          findOne: (...args: unknown[]) => mockIssueFindOne(...args),
          replaceOne: (...args: unknown[]) => mockIssueReplaceOne(...args),
        }
      : {
          find: (...args: unknown[]) => mockSyncFind(...args),
          findOne: (...args: unknown[]) => mockSyncFindOne(...args),
          findOneAndUpdate: (...args: unknown[]) => mockSyncFindOneAndUpdate(...args),
          updateOne: (...args: unknown[]) => mockSyncUpdateOne(...args),
        },
  ),
}));

import {
  buildTomeIssueContext,
  loadTomeIssueCache,
  markTomeIssueRepoStale,
  upsertCachedTomeIssue,
} from "@/lib/tome/github-issue-cache";

const linkedIssue = {
  contentType: "issue" as const,
  repo: "example/service",
  number: 42,
  title: "Critical decision",
  body: "Large body that is cached but not injected into prompts",
  url: "https://github.com/example/service/issues/42",
  state: "open" as const,
  stateReason: null,
  displayStatus: "open" as const,
  priority: "critical" as const,
  labels: ["needs attention", "decision"],
  assignees: ["test-user"],
  author: "issue-author",
  milestone: null,
  category: null,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-27T00:00:00Z",
  closedAt: null,
};

const cachedRow = {
  _id: "example/service#42",
  repo: "example/service",
  content_type: "issue" as const,
  number: 42,
  title: "Critical decision",
  body: "Large body that is cached but not injected into prompts",
  url: "https://github.com/example/service/issues/42",
  state: "open" as const,
  state_reason: null,
  display_status: "open" as const,
  priority: "critical" as const,
  labels: ["needs attention", "decision"],
  labels_normalized: ["needs attention", "decision"],
  assignees: ["test-user"],
  author: "issue-author",
  milestone: null,
  github_created_at: "2026-08-01T00:00:00Z",
  github_updated_at: "2026-08-27T00:00:00Z",
  github_closed_at: null,
  cached_at: new Date("2026-08-27T00:00:00Z"),
};

function cursor(rows: unknown[]) {
  return {
    sort: jest.fn(() => ({ toArray: jest.fn(async () => rows) })),
  };
}

describe("TOME MongoDB GitHub issue cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIssueBulkWrite.mockResolvedValue({ acknowledged: true });
    mockIssueDeleteMany.mockResolvedValue({ acknowledged: true });
    mockSyncUpdateOne.mockResolvedValue({ acknowledged: true });
    mockSyncFindOne.mockResolvedValue(null);
    mockIssueFindOne.mockResolvedValue(null);
    mockIssueReplaceOne.mockResolvedValue({ acknowledged: true });
    mockListDiscussions.mockResolvedValue([]);
    mockSyncFindOneAndUpdate.mockImplementation(
      async (_filter: unknown, update: { $set: { sync_owner: string } }) => ({
        sync_owner: update.$set.sync_owner,
      }),
    );
  });

  it("hydrates a cold repository once and stores a full MongoDB snapshot", async () => {
    const ready = {
      _id: "example/service",
      status: "ready",
      needs_reconciliation: false,
      last_full_sync_at: new Date("2026-08-27T00:00:00Z"),
    };
    mockSyncFind
      .mockReturnValueOnce(cursor([]))
      .mockReturnValueOnce(cursor([ready]));
    mockIssueFind.mockReturnValue(cursor([cachedRow]));
    mockListIssues.mockResolvedValue([linkedIssue]);

    const result = await loadTomeIssueCache({
      repos: ["example/service"],
      token: "delegated-token",
    });

    expect(mockListIssues).toHaveBeenCalledWith(
      "delegated-token",
      ["example/service"],
      { refresh: true },
    );
    expect(mockListDiscussions).toHaveBeenCalledWith(
      "delegated-token",
      ["example/service"],
    );
    expect(mockIssueBulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          replaceOne: expect.objectContaining({
            replacement: expect.objectContaining({
              _id: "example/service#42",
              labels_normalized: ["needs attention", "decision"],
            }),
          }),
        }),
      ],
      { ordered: false },
    );
    expect(mockSyncUpdateOne).toHaveBeenCalledWith(
      { _id: "example/service", sync_owner: expect.any(String) },
      expect.objectContaining({ $inc: { cache_generation: 1 } }),
    );
    expect(result.issues).toEqual([linkedIssue]);
  });

  it("serves a ready snapshot without calling GitHub", async () => {
    const ready = {
      _id: "example/service",
      status: "ready",
      needs_reconciliation: false,
    };
    mockSyncFind
      .mockReturnValueOnce(cursor([ready]))
      .mockReturnValueOnce(cursor([ready]));
    mockIssueFind.mockReturnValue(cursor([cachedRow]));

    await loadTomeIssueCache({
      repos: ["example/service"],
      token: "delegated-token",
    });

    expect(mockListIssues).not.toHaveBeenCalled();
  });

  it("does not duplicate a repository sync claimed by another replica", async () => {
    const ready = {
      _id: "example/service",
      status: "ready",
      needs_reconciliation: false,
    };
    mockSyncFind
      .mockReturnValueOnce(cursor([]))
      .mockReturnValueOnce(cursor([ready]));
    mockSyncFindOneAndUpdate.mockResolvedValue({ sync_owner: "other-replica" });
    mockSyncFindOne.mockResolvedValue(ready);
    mockIssueFind.mockReturnValue(cursor([cachedRow]));

    await loadTomeIssueCache({
      repos: ["example/service"],
      token: "delegated-token",
    });

    expect(mockListIssues).not.toHaveBeenCalled();
  });

  it("builds a bounded Decisions/Critical index without issue bodies", async () => {
    mockIssueFind.mockReturnValue(cursor([cachedRow]));

    const context = await buildTomeIssueContext(["example/service"], 1);

    expect(context).toMatchObject({
      decision_count: 1,
      critical_count: 1,
      decisions: [expect.objectContaining({ repo: "example/service", number: 42 })],
      critical: [expect.objectContaining({ repo: "example/service", number: 42 })],
    });
    expect(JSON.stringify(context)).not.toContain(linkedIssue.body);
  });

  it("increments the cache generation only after a webhook row is visible", async () => {
    await upsertCachedTomeIssue(linkedIssue, {
      repoId: 123,
      eventType: "issues",
      deliveryId: "delivery-1",
      webhook: true,
    });

    expect(mockIssueReplaceOne).toHaveBeenCalledWith(
      { _id: "example/service#42" },
      expect.objectContaining({ _id: "example/service#42" }),
      { upsert: true },
    );
    expect(mockIssueReplaceOne.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncUpdateOne.mock.invocationCallOrder[0],
    );
    expect(mockSyncUpdateOne).toHaveBeenCalledWith(
      { _id: "example/service" },
      expect.objectContaining({ $inc: { cache_generation: 1 } }),
      { upsert: true },
    );
  });

  it("does not signal a cache change for an older duplicate snapshot", async () => {
    mockIssueFindOne.mockResolvedValue({
      ...cachedRow,
      github_updated_at: "2026-08-28T00:00:00Z",
    });

    await upsertCachedTomeIssue(linkedIssue, {
      repoId: 123,
      eventType: "issues",
      deliveryId: "delivery-1",
      webhook: true,
    });

    expect(mockIssueReplaceOne).not.toHaveBeenCalled();
    expect(mockSyncUpdateOne).toHaveBeenCalledWith(
      { _id: "example/service" },
      expect.not.objectContaining({ $inc: expect.anything() }),
      { upsert: true },
    );
  });

  it("signals repository-wide invalidation to every SSE replica", async () => {
    await markTomeIssueRepoStale({
      repoId: 123,
      fullName: "example/service",
      eventType: "label",
      deliveryId: "delivery-2",
      webhook: true,
    });

    expect(mockSyncUpdateOne).toHaveBeenCalledWith(
      { _id: "example/service" },
      expect.objectContaining({ $inc: { cache_generation: 1 } }),
      { upsert: true },
    );
  });
});
