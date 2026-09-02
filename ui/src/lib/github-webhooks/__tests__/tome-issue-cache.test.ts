/** @jest-environment node */

const mockProjectFindOne = jest.fn();
const mockProjectFind = jest.fn();
const mockUpsertIssue = jest.fn();
const mockMarkStale = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => ({
    findOne: (...args: unknown[]) => mockProjectFindOne(...args),
    find: (...args: unknown[]) => mockProjectFind(...args),
  })),
}));
jest.mock("@/lib/tome/github-issue-cache", () => ({
  upsertCachedTomeIssue: (...args: unknown[]) => mockUpsertIssue(...args),
  markTomeIssueRepoStale: (...args: unknown[]) => mockMarkStale(...args),
}));

import {
  isRepositoryAttachedToTome,
  isTomeIssueCacheEvent,
  projectSlugsForRepository,
  recordTomeIssueCacheEvent,
} from "@/lib/github-webhooks/tome-issue-cache";

const issue = {
  repo: "example/service",
  number: 42,
  title: "Example issue",
  body: null,
  url: "https://github.com/example/service/issues/42",
  state: "open" as const,
  stateReason: null,
  displayStatus: "open" as const,
  priority: null,
  labels: ["critical"],
  assignees: [],
  author: null,
  milestone: null,
  createdAt: null,
  updatedAt: "2026-08-27T00:00:00Z",
  closedAt: null,
};

describe("TOME GitHub webhook cache consumer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("recognizes issue-related events only", () => {
    expect(isTomeIssueCacheEvent("issues")).toBe(true);
    expect(isTomeIssueCacheEvent("label")).toBe(true);
    expect(isTomeIssueCacheEvent("milestone")).toBe(true);
    expect(isTomeIssueCacheEvent("discussion")).toBe(true);
    expect(isTomeIssueCacheEvent("pull_request")).toBe(false);
  });

  it("upserts the affected discussion from a discussion webhook", async () => {
    const discussion = { ...issue, contentType: "discussion" as const };
    await recordTomeIssueCacheEvent({
      repoId: 123,
      fullName: "Example/Service",
      eventType: "discussion",
      deliveryId: "delivery-discussion",
      discussion,
    });

    expect(mockUpsertIssue).toHaveBeenCalledWith(discussion, {
      repoId: 123,
      eventType: "discussion",
      deliveryId: "delivery-discussion",
      webhook: true,
    });
  });

  it("recognizes repositories attached to a TOME project", async () => {
    mockProjectFindOne.mockResolvedValue({ _id: "project-1" });

    await expect(
      isRepositoryAttachedToTome(123, "example/service"),
    ).resolves.toBe(true);
    expect(mockProjectFindOne).toHaveBeenCalledWith(
      {
        $or: [
          { "sources.github_repos.id": 123 },
          { "sources.github_repos.full_name": "example/service" },
          {
            "sources.repos": {
              $in: [
                "example/service",
                "https://github.com/example/service",
                "https://github.com/example/service.git",
              ],
            },
          },
        ],
      },
      { projection: { _id: 1 } },
    );
  });

  it("resolves the slugs of attached projects that haven't opted out of the feed", async () => {
    mockProjectFind.mockReturnValue({
      toArray: async () => [{ slug: "caipe" }, { slug: "" }],
    });

    await expect(
      projectSlugsForRepository(123, "example/service"),
    ).resolves.toEqual(["caipe"]);
    expect(mockProjectFind).toHaveBeenCalledWith(
      {
        $or: [
          { "sources.github_repos.id": 123 },
          { "sources.github_repos.full_name": "example/service" },
          {
            "sources.repos": {
              $in: [
                "example/service",
                "https://github.com/example/service",
                "https://github.com/example/service.git",
              ],
            },
          },
        ],
        sources_feed_enabled: { $ne: false },
      },
      { projection: { slug: 1 } },
    );
  });

  it("upserts the affected issue from an issue webhook", async () => {
    await recordTomeIssueCacheEvent({
      repoId: 123,
      fullName: "Example/Service",
      eventType: "issues",
      deliveryId: "delivery-1",
      issue,
    });

    expect(mockUpsertIssue).toHaveBeenCalledWith(issue, {
      repoId: 123,
      eventType: "issues",
      deliveryId: "delivery-1",
      webhook: true,
    });
    expect(mockMarkStale).not.toHaveBeenCalled();
  });

  it("marks a repository stale for repository-wide label events", async () => {
    await recordTomeIssueCacheEvent({
      repoId: 123,
      fullName: "Example/Service",
      eventType: "label",
      deliveryId: "delivery-2",
    });

    expect(mockMarkStale).toHaveBeenCalledWith({
      repoId: 123,
      fullName: "Example/Service",
      eventType: "label",
      deliveryId: "delivery-2",
      webhook: true,
    });
    expect(mockUpsertIssue).not.toHaveBeenCalled();
  });

  it("ignores pull-request comments that have no issue snapshot", async () => {
    await recordTomeIssueCacheEvent({
      repoId: 123,
      fullName: "Example/Service",
      eventType: "issue_comment",
      deliveryId: "delivery-3",
    });

    expect(mockMarkStale).not.toHaveBeenCalled();
    expect(mockUpsertIssue).not.toHaveBeenCalled();
  });
});
