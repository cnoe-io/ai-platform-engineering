/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireEditor = jest.fn();
const mockProjectRepos = jest.fn();
const mockResolveCredential = jest.fn();
const mockGetMetadata = jest.fn();
const mockListWebhooks = jest.fn();
const mockCreateWebhook = jest.fn();
const mockUpdateWebhook = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireEditor(...args),
}));
jest.mock("@/lib/tome/github-issue-scope", () => ({
  projectGitHubRepos: (...args: unknown[]) => mockProjectRepos(...args),
  resolveTomeGitHubCredential: (...args: unknown[]) =>
    mockResolveCredential(...args),
}));
jest.mock("@/lib/github-webhooks/client", () => {
  class MockGitHubClientError extends Error {}
  return {
    GitHubClientError: MockGitHubClientError,
    createGitHubClient: () => ({
      getRepoMetadata: (...args: unknown[]) => mockGetMetadata(...args),
      listRepoWebhooks: (...args: unknown[]) => mockListWebhooks(...args),
      createRepoWebhook: (...args: unknown[]) => mockCreateWebhook(...args),
      updateRepoWebhook: (...args: unknown[]) => mockUpdateWebhook(...args),
    }),
  };
});

import { POST } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };

function request(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(
    "http://example.test/api/tome/projects/example-project/github-webhooks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST TOME GitHub webhook subscription", () => {
  const originalEnabled = process.env.TOME_GITHUB_WEBHOOK_ENABLED;
  const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const originalWebhookUrl = process.env.TOME_GITHUB_WEBHOOK_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TOME_GITHUB_WEBHOOK_ENABLED = "true";
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.TOME_GITHUB_WEBHOOK_URL;
    mockLoadTomeProject.mockResolvedValue({
      project: { slug: "example-project" },
      canEdit: true,
    });
    mockProjectRepos.mockReturnValue(["example/service"]);
    mockResolveCredential.mockResolvedValue({ token: "github-token" });
    mockGetMetadata.mockResolvedValue({
      id: 123,
      full_name: "example/service",
      default_branch: "main",
      permissions: { admin: true },
    });
    mockListWebhooks.mockResolvedValue([]);
    mockCreateWebhook.mockResolvedValue({ id: 99, config: {} });
    mockUpdateWebhook.mockResolvedValue({ id: 99, config: {} });
  });

  afterAll(() => {
    process.env.TOME_GITHUB_WEBHOOK_ENABLED = originalEnabled;
    process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    if (originalWebhookUrl === undefined) {
      delete process.env.TOME_GITHUB_WEBHOOK_URL;
    } else {
      process.env.TOME_GITHUB_WEBHOOK_URL = originalWebhookUrl;
    }
  });

  it("installs the canonical issue webhook with a delegated admin credential", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(201);
    expect(mockCreateWebhook).toHaveBeenCalledWith("example", "service", {
      callbackUrl: "http://example.test/api/webhooks/github",
      secret: "test-secret",
      events: [
        "issues",
        "issue_comment",
        "discussion",
        "discussion_comment",
        "label",
        "milestone",
        "pull_request",
      ],
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        repo: "example/service",
        created: true,
        webhookId: 99,
      },
    });
  });

  it("fails closed when webhook ingestion is not configured", async () => {
    process.env.TOME_GITHUB_WEBHOOK_ENABLED = "false";

    const response = await POST(request(), context);

    expect(response.status).toBe(503);
    expect(mockCreateWebhook).not.toHaveBeenCalled();
  });

  it("upgrades an existing issue webhook to include discussion events", async () => {
    mockListWebhooks.mockResolvedValue([{
      id: 99,
      active: true,
      events: ["issues", "issue_comment", "label", "milestone"],
      config: { url: "http://example.test/api/webhooks/github" },
    }]);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mockCreateWebhook).not.toHaveBeenCalled();
    expect(mockUpdateWebhook).toHaveBeenCalledWith(
      "example",
      "service",
      99,
      expect.objectContaining({
        events: expect.arrayContaining(["discussion", "discussion_comment"]),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { created: false, updated: true },
    });
  });

  it("installs through the shared SQS relay for private deployments", async () => {
    process.env.TOME_GITHUB_WEBHOOK_URL =
      "https://relay.example.com/github";

    const response = await POST(request(), context);

    expect(response.status).toBe(201);
    expect(mockCreateWebhook).toHaveBeenCalledWith("example", "service", {
      callbackUrl: "https://relay.example.com/github",
      secret: "test-secret",
      events: [
        "issues",
        "issue_comment",
        "discussion",
        "discussion_comment",
        "label",
        "milestone",
        "pull_request",
      ],
    });
  });
});
