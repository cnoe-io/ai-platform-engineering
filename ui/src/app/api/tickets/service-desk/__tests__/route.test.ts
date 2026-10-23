/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerConfig = jest.fn();
const mockCreateGitHubTicket = jest.fn();
const mockUploadScreenshotToGitHub = jest.fn();
const mockRecordProblemReportFeedback = jest.fn();
const mockSubmitOnce = jest.fn();

const FIXED_USER = { email: "user@example.com", name: "Test User", role: "user" };

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode = 500, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return {
    ApiError,
    withErrorHandler:
      (handler: (request: NextRequest) => Promise<Response>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (error) {
          const status = error instanceof ApiError ? error.statusCode : 500;
          return new Response(
            JSON.stringify({ success: false, error: (error as Error).message }),
            { status, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    withAuth: async <T>(
      _request: NextRequest,
      handler: (request: NextRequest, user: typeof FIXED_USER) => Promise<T>,
    ): Promise<T> => handler(_request, FIXED_USER),
  };
});

jest.mock("@/lib/config", () => ({
  getServerConfig: () => mockGetServerConfig(),
}));

jest.mock("@/lib/github-ticket", () => ({
  createGitHubTicket: (...args: unknown[]) => mockCreateGitHubTicket(...args),
  uploadScreenshotToGitHub: (...args: unknown[]) => mockUploadScreenshotToGitHub(...args),
}));

jest.mock("@/lib/feedback-report-store", () => ({
  recordProblemReportFeedback: (...args: unknown[]) => mockRecordProblemReportFeedback(...args),
}));

jest.mock("@/lib/service-desk-submissions", () => ({
  submitServiceDeskOnce: (...args: unknown[]) => mockSubmitOnce(...args),
}));

import { POST } from "../route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://example.test/api/tickets/service-desk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_CONFIG = {
  serviceDeskGithubEnabled: true,
  serviceDeskGithubRepo: "example/support",
  serviceDeskGithubLabel: "service-desk",
  serviceDeskDefaultAssignee: "example-bot",
  githubScreenshotsRepo: null as string | null,
};

describe("POST /api/tickets/service-desk", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitOnce.mockImplementation((_reporter, _key, create) => create());
    mockGetServerConfig.mockReturnValue({ ...BASE_CONFIG });
    process.env.REPORT_PROBLEM_GITHUB_TOKEN = "ghp_test_token";
    mockCreateGitHubTicket.mockResolvedValue({
      id: "#7",
      number: 7,
      url: "https://github.com/example/support/issues/7",
      provider: "github",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 503 when service-desk GitHub routing is disabled", async () => {
    mockGetServerConfig.mockReturnValue({ ...BASE_CONFIG, serviceDeskGithubEnabled: false });

    const res = await POST(makeRequest({ description: "x", contextUrl: "https://example.test" }));
    expect(res.status).toBe(503);
    expect(mockCreateGitHubTicket).not.toHaveBeenCalled();
  });

  it("returns 503 when no repo is configured", async () => {
    mockGetServerConfig.mockReturnValue({ ...BASE_CONFIG, serviceDeskGithubRepo: null });

    const res = await POST(makeRequest({ description: "x", contextUrl: "https://example.test" }));
    expect(res.status).toBe(503);
  });

  it("returns 503 when the token is missing", async () => {
    delete process.env.REPORT_PROBLEM_GITHUB_TOKEN;
    delete process.env.GITHUB_TICKET_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const res = await POST(makeRequest({ description: "x", contextUrl: "https://example.test" }));
    expect(res.status).toBe(503);
  });

  it("returns 400 when contextUrl is missing", async () => {
    const res = await POST(makeRequest({ description: "Something broke" }));
    expect(res.status).toBe(400);
  });

  it("creates a service-desk issue on the SD repo with the SD label + default assignee", async () => {
    const res = await POST(
      makeRequest({
        description: "Chat area is broken",
        contextUrl: "https://example.test/chat/abc",
        area: "Chat",
        issueType: "Bug",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      id: "#7",
      number: 7,
      url: "https://github.com/example/support/issues/7",
      provider: "github",
    });

    expect(mockCreateGitHubTicket).toHaveBeenCalledWith(
      "example/support",
      "ghp_test_token",
      expect.objectContaining({
        description: "Chat area is broken",
        userEmail: FIXED_USER.email,
        label: "service-desk",
        assignees: ["example-bot"],
        area: "Chat",
        issueType: "Bug",
      }),
    );

    expect(mockRecordProblemReportFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        area: "Chat",
        ticket: expect.objectContaining({ id: "#7" }),
      }),
    );
  });

  it("omits assignees when no default assignee is configured", async () => {
    mockGetServerConfig.mockReturnValue({ ...BASE_CONFIG, serviceDeskDefaultAssignee: "" });

    await POST(
      makeRequest({
        description: "Skills page error",
        contextUrl: "https://example.test",
        area: "Skills",
      }),
    );

    expect(mockCreateGitHubTicket).toHaveBeenCalledWith(
      "example/support",
      "ghp_test_token",
      expect.objectContaining({ assignees: undefined }),
    );
  });
});


describe("authenticated chat submissions", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerConfig.mockReturnValue({ ...BASE_CONFIG });
    process.env.SERVICE_DESK_GITHUB_TOKEN = "service-ticket-token";
    process.env.NEXTAUTH_URL = "https://example.test";
    mockCreateGitHubTicket.mockResolvedValue({ id: "#7", number: 7, url: "https://example.test/issues/7", provider: "github" });
    mockSubmitOnce.mockImplementation((_reporter, _key, create) => create());
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("fixes the destination, reporter, label and chat link on the server", async () => {
    const res = await POST(makeRequest({
      title: "Approved request", description: "Approved details",
      conversationId: "00000000-0000-0000-0000-000000000001", requestId: "a".repeat(64),
      repo: "untrusted/other", userEmail: "spoof@example.com", label: "other", contextUrl: "https://untrusted.example.org",
    }));
    expect(res.status).toBe(200);
    expect(mockSubmitOnce).toHaveBeenCalledWith(FIXED_USER.email, "a".repeat(64), expect.any(Function));
    expect(mockCreateGitHubTicket).toHaveBeenCalledWith("example/support", "service-ticket-token", expect.objectContaining({
      title: "Approved request", description: "Approved details", userEmail: FIXED_USER.email,
      label: "service-desk", contextUrl: "https://example.test/chat/00000000-0000-0000-0000-000000000001",
    }));
  });

  it.each([
    null, [], { title: 7 }, { title: "" }, { title: "x".repeat(257) },
    { requestId: "bad" }, { conversationId: "../other", requestId: "a".repeat(64) },
    { conversationId: "00000000-0000-0000-0000-000000000001" },
  ])("rejects malformed chat submission %j before a write", async (extra) => {
    const body = extra === null || Array.isArray(extra) ? extra : { description: "Details", contextUrl: "https://example.test", ...extra };
    expect((await POST(makeRequest(body))).status).toBe(400);
    expect(mockCreateGitHubTicket).not.toHaveBeenCalled();
  });
});
