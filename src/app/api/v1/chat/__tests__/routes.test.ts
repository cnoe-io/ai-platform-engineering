/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";

import { POST as invokePost } from "../invoke/route";
import { POST as cancelPost } from "../stream/cancel/route";
import { POST as resumePost } from "../stream/resume/route";
import { POST as startPost } from "../stream/start/route";

const mockAuthenticateRequest = jest.fn();
const mockGetDynamicAgentsConfig = jest.fn();
const mockProxySSEStream = jest.fn();
const mockProxyJSONRequest = jest.fn();
const mockRequireAgentUsePermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockRequireConversationResourcePermission = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
  getDynamicAgentsConfig: (...args: unknown[]) => mockGetDynamicAgentsConfig(...args),
  proxySSEStream: (...args: unknown[]) => mockProxySSEStream(...args),
  proxyJSONRequest: (...args: unknown[]) => mockProxyJSONRequest(...args),
}));

jest.mock("@/lib/rbac/openfga-agent-authz", () => ({
  requireAgentUsePermission: (...args: unknown[]) => mockRequireAgentUsePermission(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/rbac/conversation-implicit-authz", () => ({
  requireConversationResourcePermission: (...args: unknown[]) =>
    mockRequireConversationResourcePermission(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

function jsonRequest(path: string, body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("Dynamic Agent chat Web UI backend routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({
      subject: "alice-sub",
      email: "alice@example.com",
      tenantId: "default",
      bearerToken: "token",
    });
    mockGetDynamicAgentsConfig.mockReturnValue({ dynamicAgentsUrl: "http://dynamic-agents:8000" });
    mockRequireAgentUsePermission.mockResolvedValue(null);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockRequireConversationResourcePermission.mockResolvedValue(undefined);
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn(async () => ({
        _id: "conv-1",
        owner_id: "alice@example.com",
        owner_subject: "alice-sub",
      })),
    });
    mockProxySSEStream.mockResolvedValue(new Response("event: done\n\n", { status: 200 }));
    mockProxyJSONRequest.mockResolvedValue(NextResponse.json({ success: true }));
  });

  it.each([
    [
      "start",
      startPost,
      "/api/v1/chat/stream/start",
      { message: "hi", conversation_id: "conv-1", agent_id: "agent-1" },
      mockProxySSEStream,
    ],
    [
      "invoke",
      invokePost,
      "/api/v1/chat/invoke",
      { message: "hi", conversation_id: "conv-1", agent_id: "agent-1" },
      mockProxyJSONRequest,
    ],
    [
      "resume",
      resumePost,
      "/api/v1/chat/stream/resume",
      { conversation_id: "conv-1", agent_id: "agent-1", resume_data: "{}" },
      mockProxySSEStream,
    ],
  ])("checks OpenFGA before proxying %s requests", async (_name, handler, path, body, proxy) => {
    const response = await handler(jsonRequest(path, body));

    expect(response.status).toBe(200);
    expect(mockRequireAgentUsePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "alice-sub",
        agentId: "agent-1",
        email: "alice@example.com",
        tenantId: "default",
        traceparent: expect.stringMatching(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/),
      }),
    );
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub", user: { email: "alice@example.com" } }),
      "alice@example.com",
      expect.objectContaining({ _id: "conv-1" }),
      "write",
    );
    expect(proxy.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        traceparent: expect.stringMatching(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/),
      }),
    );
  });

  it("threads isServiceAccount into the conversation write check so SA callers graph as service_account:<sub>", async () => {
    // Regression: requireConversationWriteAccess dropped isServiceAccount, so an
    // SA-routed Slack request was graphed as user:<sub> and 403'd conversation#write
    // even though the SA held the writer grant on the conversation it created.
    mockAuthenticateRequest.mockResolvedValue({
      subject: "sa-sub",
      email: "service-account-anon@noreply",
      tenantId: "default",
      bearerToken: "token",
      isServiceAccount: true,
    });

    const response = await startPost(
      jsonRequest("/api/v1/chat/stream/start", {
        message: "hi",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "sa-sub", isServiceAccount: true }),
      expect.anything(),
      expect.objectContaining({ _id: "conv-1" }),
      "write",
    );
  });

  it.each([
    ["start", startPost, "/api/v1/chat/stream/start", { message: "hi", conversation_id: "conv-1", agent_id: "agent-1" }],
    ["invoke", invokePost, "/api/v1/chat/invoke", { message: "hi", conversation_id: "conv-1", agent_id: "agent-1" }],
    ["resume", resumePost, "/api/v1/chat/stream/resume", { conversation_id: "conv-1", agent_id: "agent-1", resume_data: "{}" }],
  ])("returns OpenFGA denial before proxying %s requests", async (_name, handler, path, body) => {
    mockRequireAgentUsePermission.mockResolvedValue(
      NextResponse.json(
        { success: false, code: "agent#use", reason: "pdp_denied", action: "contact_admin" },
        { status: 403 },
      ),
    );

    const response = await handler(jsonRequest(path, body));

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ reason: "pdp_denied", action: "contact_admin" });
    expect(mockProxySSEStream).not.toHaveBeenCalled();
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("does not call OpenFGA when authentication fails", async () => {
    mockAuthenticateRequest.mockResolvedValue(
      NextResponse.json(
        { success: false, code: "NOT_SIGNED_IN", reason: "not_signed_in", action: "sign_in" },
        { status: 401 },
      ),
    );

    const response = await startPost(
      jsonRequest("/api/v1/chat/stream/start", {
        message: "hi",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(401);
    expect(mockRequireAgentUsePermission).not.toHaveBeenCalled();
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
    expect(mockProxySSEStream).not.toHaveBeenCalled();
  });

  it("returns OpenFGA unavailable responses before proxying protected requests", async () => {
    mockRequireAgentUsePermission.mockResolvedValue(
      NextResponse.json(
        { success: false, code: "PDP_UNAVAILABLE", reason: "pdp_unavailable", action: "retry" },
        { status: 503 },
      ),
    );

    const response = await startPost(
      jsonRequest("/api/v1/chat/stream/start", {
        message: "hi",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(503);
    expect(await jsonBody(response)).toMatchObject({
      code: "PDP_UNAVAILABLE",
      reason: "pdp_unavailable",
      action: "retry",
    });
    expect(mockProxySSEStream).not.toHaveBeenCalled();
  });

  it.each([
    ["start", startPost, "/api/v1/chat/stream/start", { message: "hi", agent_id: "agent-1" }],
    ["invoke", invokePost, "/api/v1/chat/invoke", { message: "hi", conversation_id: "conv-1" }],
    ["resume", resumePost, "/api/v1/chat/stream/resume", { conversation_id: "conv-1", agent_id: "agent-1" }],
    ["cancel", cancelPost, "/api/v1/chat/stream/cancel", { conversation_id: "conv-1" }],
  ])("returns 400 before any OpenFGA check when required %s fields are missing", async (_name, handler, path, body) => {
    const response = await handler(jsonRequest(path, body));

    expect(response.status).toBe(400);
    expect(mockRequireAgentUsePermission).not.toHaveBeenCalled();
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
    expect(mockProxySSEStream).not.toHaveBeenCalled();
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("does not check conversation access when the agent use gate denies first", async () => {
    mockRequireAgentUsePermission.mockResolvedValue(
      NextResponse.json({ success: false, reason: "pdp_denied" }, { status: 403 }),
    );

    const response = await invokePost(
      jsonRequest("/api/v1/chat/invoke", {
        message: "hi",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("checks conversation and agent permission before proxying cancel", async () => {
    const response = await cancelPost(
      jsonRequest("/api/v1/chat/stream/cancel", {
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(1);
    expect(mockRequireAgentUsePermission).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "alice-sub", agentId: "agent-1" }),
    );
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub", user: { email: "alice@example.com" } }),
      "alice@example.com",
      expect.objectContaining({ _id: "conv-1" }),
      "write",
    );
    expect(mockProxyJSONRequest).toHaveBeenCalledTimes(1);
  });

  it("returns conversation denial before proxying", async () => {
    mockRequireConversationResourcePermission.mockRejectedValue(
      Object.assign(new Error("denied"), { statusCode: 403, code: "conversation#write" }),
    );

    const response = await invokePost(
      jsonRequest("/api/v1/chat/invoke", {
        message: "hi",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({
      success: false,
      error: "denied",
      code: "conversation#write",
    });
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("returns conversation denial before proxying cancel", async () => {
    mockRequireConversationResourcePermission.mockRejectedValue(
      Object.assign(new Error("cancel denied"), { statusCode: 403, code: "conversation#write" }),
    );

    const response = await cancelPost(
      jsonRequest("/api/v1/chat/stream/cancel", {
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({
      success: false,
      error: "cancel denied",
      code: "conversation#write",
    });
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("returns 404 before proxying when the conversation does not exist", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn(async () => null),
    });

    const response = await startPost(
      jsonRequest("/api/v1/chat/stream/start", {
        message: "hi",
        conversation_id: "missing-conv",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({
      success: false,
      error: "Conversation not found",
      code: "conversation#write",
    });
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
    expect(mockProxySSEStream).not.toHaveBeenCalled();
  });
});
