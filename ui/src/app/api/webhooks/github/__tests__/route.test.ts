/** @jest-environment node */

const mockIsAttachedToTome = jest.fn();
const mockVerifyWebhook = jest.fn();
const mockPublishEvent = jest.fn();

jest.mock("@/lib/github-webhooks/tome-issue-cache", () => ({
  isRepositoryAttachedToTome: (...args: unknown[]) =>
    mockIsAttachedToTome(...args),
}));
jest.mock("@/lib/github-webhooks/verify", () => ({
  verifyGitHubWebhook: (...args: unknown[]) => mockVerifyWebhook(...args),
}));
jest.mock("@/lib/events/bus", () => ({
  publishCaipeEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

import { POST } from "../route";

function request(eventType = "issues"): Request {
  const discussion = eventType.startsWith("discussion")
    ? {
        number: 52,
        title: "Architecture direction",
        body: "Proposal body",
        html_url: "https://github.com/example/service/discussions/52",
        state: "open",
        labels: [{ name: "decision" }],
        user: { login: "discussion-author" },
        category: { name: "Ideas" },
        updated_at: "2026-08-27T01:00:00Z",
      }
    : undefined;
  return new Request("http://example.test/api/webhooks/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": eventType,
      "X-GitHub-Delivery": "delivery-1",
      "X-Hub-Signature-256": "sha256=signature",
    },
    body: JSON.stringify({
      action: "edited",
      repository: { id: 123, full_name: "example/service" },
      issue: {
        number: 42,
        title: "Example issue",
        body: "Example body",
        html_url: "https://github.com/example/service/issues/42",
        state: "open",
        labels: [{ name: "critical" }],
        assignees: [{ login: "test-user" }],
        user: { login: "issue-author" },
        updated_at: "2026-08-27T00:00:00Z",
      },
      ...(discussion ? { discussion, issue: undefined } : {}),
      sender: { login: "test-user" },
    }),
  });
}

function pullRequestRequest(action: string): Request {
  return new Request("http://example.test/api/webhooks/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "pull_request",
      "X-GitHub-Delivery": "delivery-pr-1",
      "X-Hub-Signature-256": "sha256=signature",
    },
    body: JSON.stringify({
      action,
      repository: { id: 123, full_name: "example/service" },
      pull_request: {
        number: 7,
        title: "Add retry to the sync job",
        html_url: "https://github.com/example/service/pull/7",
        state: "open",
        labels: [{ name: "status:in-progress" }],
        user: { login: "pr-author" },
        updated_at: "2026-08-27T02:00:00Z",
      },
      label: { name: "status:in-progress" },
      sender: { login: "test-user" },
    }),
  });
}

describe("shared GitHub webhook ingress", () => {
  const originalEnabled = process.env.TOME_GITHUB_WEBHOOK_ENABLED;
  const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TOME_GITHUB_WEBHOOK_ENABLED = "true";
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    mockIsAttachedToTome.mockResolvedValue(true);
    mockVerifyWebhook.mockReturnValue({ valid: true });
    mockPublishEvent.mockResolvedValue({
      duplicate: false,
      subscribers: ["tome.github-issue-cache.v1"],
    });
  });

  afterAll(() => {
    process.env.TOME_GITHUB_WEBHOOK_ENABLED = originalEnabled;
    process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
  });

  it("normalizes a verified issue delivery onto the CAIPE event bus", async () => {
    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(mockPublishEvent).toHaveBeenCalledWith({
      _id: "github:delivery-1",
      specversion: "1.0",
      source: "github",
      type: "github.issues.edited",
      subject: "example/service#42",
      time: new Date("2026-08-27T00:00:00Z"),
      received_at: expect.any(Date),
      data: {
        github_event: "issues",
        action: "edited",
        delivery_id: "delivery-1",
        repository_id: 123,
        repository_full_name: "example/service",
        issue_number: 42,
        issue: {
          contentType: "issue",
          repo: "example/service",
          number: 42,
          title: "Example issue",
          body: "Example body",
          url: "https://github.com/example/service/issues/42",
          state: "open",
          stateReason: null,
          displayStatus: "open",
          priority: "critical",
          labels: ["critical"],
          assignees: ["test-user"],
          author: "issue-author",
          milestone: null,
          createdAt: null,
          updatedAt: "2026-08-27T00:00:00Z",
          closedAt: null,
        },
        pull_request_number: null,
        pull_request: null,
        discussion_number: null,
        discussion: null,
        label_name: null,
        sender_login: "test-user",
      },
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      subscribers: ["tome.github-issue-cache.v1"],
    });
  });

  it("normalizes labeled discussion deliveries onto the event bus", async () => {
    const response = await POST(request("discussion"));

    expect(response.status).toBe(202);
    expect(mockPublishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "github.discussion.edited",
        subject: "example/service:discussion#52",
        time: new Date("2026-08-27T01:00:00Z"),
        data: expect.objectContaining({
          issue: null,
          discussion_number: 52,
          discussion: expect.objectContaining({
            contentType: "discussion",
            number: 52,
            labels: ["decision"],
            category: "Ideas",
          }),
        }),
      }),
    );
  });

  it("normalizes a labeled pull_request delivery, including the label name", async () => {
    const response = await POST(pullRequestRequest("labeled"));

    expect(response.status).toBe(202);
    expect(mockPublishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "github.pull_request.labeled",
        subject: "example/service#7",
        time: new Date("2026-08-27T02:00:00Z"),
        data: expect.objectContaining({
          issue_number: null,
          issue: null,
          pull_request_number: 7,
          pull_request: expect.objectContaining({
            number: 7,
            title: "Add retry to the sync job",
            url: "https://github.com/example/service/pull/7",
            labels: ["status:in-progress"],
          }),
          label_name: "status:in-progress",
        }),
      }),
    );
  });

  it("drops pull_request actions the Feed bridge doesn't consume", async () => {
    const response = await POST(pullRequestRequest("synchronize"));

    expect(response.status).toBe(204);
    expect(mockVerifyWebhook).toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("rejects a repository that is not attached to TOME", async () => {
    mockIsAttachedToTome.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("verifies ping deliveries before acknowledging them", async () => {
    const response = await POST(request("ping"));

    expect(response.status).toBe(200);
    expect(mockVerifyWebhook).toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures", async () => {
    mockVerifyWebhook.mockReturnValue({ valid: false, reason: "digest_mismatch" });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});
