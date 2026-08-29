/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockReadableRollup = jest.fn();
const mockResolveCredential = jest.fn();
const mockResolveWriteCredential = jest.fn();
const mockRollupRepos = jest.fn();
const mockLoadIssueCache = jest.fn();
const mockUpdateIssueStatus = jest.fn();
const mockUpdateIssueLabel = jest.fn();
const mockUpsertCachedIssue = jest.fn();
const mockRequireTomeEditor = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));
jest.mock("@/lib/tome/github-issue-scope", () => ({
  readableTomeRollupProjects: (...args: unknown[]) =>
    mockReadableRollup(...args),
  resolveTomeGitHubCredential: (...args: unknown[]) =>
    mockResolveCredential(...args),
  resolveTomeGitHubWriteCredential: (...args: unknown[]) =>
    mockResolveWriteCredential(...args),
  rollupGitHubRepos: (...args: unknown[]) => mockRollupRepos(...args),
}));
jest.mock("@/lib/github-issue-link", () => ({
  updateGitHubIssueLabel: (...args: unknown[]) =>
    mockUpdateIssueLabel(...args),
  updateGitHubIssueStatus: (...args: unknown[]) =>
    mockUpdateIssueStatus(...args),
  normalizeGitHubRepo: (repo: string) => {
    const normalized = repo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    if (normalized.split("/").length !== 2) throw new Error("invalid repo");
    return normalized;
  },
  isGitHubAuthError: (error: { status?: number }) => error?.status === 401,
  isGitHubNotFoundError: (error: { status?: number }) => error?.status === 404,
}));
jest.mock("@/lib/tome/github-issue-cache", () => ({
  loadTomeIssueCache: (...args: unknown[]) => mockLoadIssueCache(...args),
  upsertCachedTomeIssue: (...args: unknown[]) => mockUpsertCachedIssue(...args),
}));

import { GET, PATCH } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };

function request(query = "", init?: RequestInit): NextRequest {
  return new NextRequest(
    `http://example.test/api/tome/projects/example-project/github-issues${query}`,
    init,
  );
}

describe("GET Tome GitHub issues", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-1",
      project: { _id: "project-1", slug: "example-project", type: "project" },
      user: { email: "viewer@example.test" },
      canEdit: true,
    });
    mockReadableRollup.mockResolvedValue([
      { _id: "project-1", slug: "example-project", type: "project" },
      { _id: "project-2", slug: "child-project", type: "project" },
    ]);
    mockRollupRepos.mockReturnValue(["example/service", "example/worker"]);
    mockResolveCredential.mockResolvedValue({
      token: "test-token",
      source: "requester",
    });
    mockResolveWriteCredential.mockResolvedValue({
      token: "steward-token",
      source: "data_steward",
      ownerEmail: "steward@example.test",
    });
    mockLoadIssueCache.mockResolvedValue({
      issues: [{
        repo: "example/service",
        number: 42,
        title: "Upstream issue",
        body: null,
        url: "https://github.com/example/service/issues/42",
        state: "open",
        stateReason: null,
        displayStatus: "open",
        priority: null,
        labels: ["feature"],
        assignees: [],
        author: null,
        milestone: null,
        createdAt: null,
        updatedAt: "2026-08-27T00:00:00Z",
        closedAt: null,
      }],
      sync: [{
        _id: "example/service",
        needs_reconciliation: false,
        last_full_sync_at: new Date("2026-08-27T00:00:00Z"),
      }],
      syncErrors: [],
    });
    mockUpsertCachedIssue.mockResolvedValue(undefined);
    mockUpdateIssueStatus.mockResolvedValue({
      issue: {
        repo: "example/service",
        number: 42,
        title: "Upstream issue",
        state: "open",
        displayStatus: "in_progress",
      },
      projectStatus: {
        linkedProjectCount: 1,
        updated: [{ projectTitle: "Example project", status: "In Progress" }],
        skipped: [],
        failed: [],
        queryFailed: false,
      },
    });
    mockUpdateIssueLabel.mockResolvedValue({
      repo: "example/service",
      number: 42,
      title: "Upstream issue",
      state: "open",
      displayStatus: "open",
      labels: ["feature", "tome-tracker"],
    });
  });

  it("adds a GitHub label with the delegated steward credential", async () => {
    const response = await PATCH(
      request("", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: "example/service",
          number: 42,
          label: "tome-tracker",
          operation: "add",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockUpdateIssueLabel).toHaveBeenCalledWith(
      "steward-token",
      "example/service",
      42,
      "tome-tracker",
      "add",
    );
    expect(mockUpsertCachedIssue).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["feature", "tome-tracker"] }),
      { eventType: "tome.issue-label", deliveryId: null },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { issue: { labels: ["feature", "tome-tracker"] } },
    });
  });

  it("updates the authoritative GitHub issue and writes through to MongoDB", async () => {
    const response = await PATCH(
      request("", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: "example/service",
          number: 42,
          status: "in_progress",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockRequireTomeEditor).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
    expect(mockUpdateIssueStatus).toHaveBeenCalledWith(
      "steward-token",
      "example/service",
      42,
      "in_progress",
    );
    expect(mockResolveWriteCredential).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
    expect(mockUpsertCachedIssue).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "example/service", number: 42 }),
      { eventType: "tome.issue-status", deliveryId: null },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        issue: {
          repo: "example/service",
          number: 42,
          displayStatus: "in_progress",
        },
        projectStatus: {
          linkedProjectCount: 1,
          updated: [{ projectTitle: "Example project", status: "In Progress" }],
        },
      },
    });
  });

  it("keeps the issue move and asks for reauthorization after a project write failure", async () => {
    mockUpdateIssueStatus.mockResolvedValue({
      issue: {
        repo: "example/service",
        number: 42,
        title: "Upstream issue",
        state: "open",
        displayStatus: "in_progress",
      },
      projectStatus: {
        linkedProjectCount: 1,
        updated: [],
        skipped: [],
        failed: [{ projectTitle: "Example project" }],
        queryFailed: false,
      },
    });

    const response = await PATCH(
      request("", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: "example/service",
          number: 42,
          status: "in_progress",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockUpsertCachedIssue).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        issue: { displayStatus: "in_progress" },
        warningCode: "TOME_STEWARD_GITHUB_PROJECT_WRITE_DENIED",
        warning: expect.stringContaining("Connected Credentials"),
      },
    });
  });

  it("directs the user to connect the data steward's GitHub credential", async () => {
    mockResolveWriteCredential.mockResolvedValue({
      source: "missing",
      ownerEmail: "steward@example.test",
    });

    const response = await PATCH(
      request("", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: "example/service",
          number: 42,
          status: "in_progress",
        }),
      }),
      context,
    );

    expect(response.status).toBe(503);
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "TOME_STEWARD_GITHUB_CREDENTIAL_REQUIRED",
      error: expect.stringContaining("steward@example.test"),
    });
  });

  it("rejects moves for repositories outside the readable project hierarchy", async () => {
    const response = await PATCH(
      request("", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: "example/unattached",
          number: 42,
          status: "resolved",
        }),
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "GITHUB_REPOSITORY_OUT_OF_SCOPE",
    });
  });

  it("returns all upstream issues from the readable repository hierarchy", async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(mockLoadIssueCache).toHaveBeenCalledWith({
      repos: ["example/service", "example/worker"],
      token: "test-token",
      refresh: false,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        issues: [{ repo: "example/service", number: 42 }],
        credentialConfigured: true,
        repos: ["example/service", "example/worker"],
        rollupProjectSlugs: ["example-project", "child-project"],
      },
    });
  });

  it("reconciles the MongoDB cache on manual refresh", async () => {
    await GET(request("?refresh=1"), context);

    expect(mockLoadIssueCache).toHaveBeenCalledWith({
      repos: ["example/service", "example/worker"],
      token: "test-token",
      refresh: true,
    });
  });

  it("filters cached issues for agent and MCP consumers", async () => {
    mockLoadIssueCache.mockResolvedValue({
      issues: [
        {
          repo: "example/service",
          number: 42,
          title: "Decision",
          body: null,
          url: "https://github.com/example/service/issues/42",
          state: "open",
          stateReason: null,
          displayStatus: "open",
          priority: null,
          labels: ["decision"],
          assignees: [],
          author: null,
          milestone: null,
          createdAt: null,
          updatedAt: "2026-08-27T00:00:00Z",
          closedAt: null,
        },
        {
          repo: "example/service",
          number: 41,
          title: "Unrelated",
          body: null,
          url: "https://github.com/example/service/issues/41",
          state: "closed",
          stateReason: "completed",
          displayStatus: "resolved",
          priority: null,
          labels: ["feature"],
          assignees: [],
          author: null,
          milestone: null,
          createdAt: null,
          updatedAt: "2026-08-26T00:00:00Z",
          closedAt: "2026-08-26T00:00:00Z",
        },
        {
          contentType: "discussion",
          category: "Decisions",
          repo: "example/service",
          number: 40,
          title: "Architecture decision",
          body: null,
          url: "https://github.com/example/service/discussions/40",
          state: "open",
          stateReason: null,
          displayStatus: "open",
          priority: "critical",
          labels: ["decision", "critical"],
          assignees: [],
          author: null,
          milestone: null,
          createdAt: null,
          updatedAt: "2026-08-25T00:00:00Z",
          closedAt: null,
        },
      ],
      sync: [],
      syncErrors: [],
    });

    const response = await GET(
      request("?label=decision&state=open&q=decision&limit=1"),
      context,
    );

    await expect(response.json()).resolves.toMatchObject({
      data: { issues: [{ number: 42, labels: ["decision"] }] },
    });

    const discussionResponse = await GET(
      request("?content_type=discussion&label=critical"),
      context,
    );
    await expect(discussionResponse.json()).resolves.toMatchObject({
      data: {
        issues: [{
          contentType: "discussion",
          number: 40,
          labels: ["decision", "critical"],
        }],
      },
    });

    const issueNumberResponse = await GET(
      request("?content_type=issue&q=%2341"),
      context,
    );
    await expect(issueNumberResponse.json()).resolves.toMatchObject({
      data: { issues: [{ number: 41, title: "Unrelated" }] },
    });
  });

  it("returns repository scope when no GitHub credential is available", async () => {
    mockResolveCredential.mockResolvedValue({ source: "missing" });

    const response = await GET(request(), context);

    expect(mockLoadIssueCache).toHaveBeenCalledWith({
      repos: ["example/service", "example/worker"],
      token: undefined,
      refresh: false,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        issues: [{ repo: "example/service", number: 42 }],
        credentialConfigured: false,
        repos: ["example/service", "example/worker"],
      },
    });
  });
});
