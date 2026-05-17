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

jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
  getDynamicAgentsConfig: (...args: unknown[]) => mockGetDynamicAgentsConfig(...args),
  proxySSEStream: (...args: unknown[]) => mockProxySSEStream(...args),
  proxyJSONRequest: (...args: unknown[]) => mockProxyJSONRequest(...args),
}));

jest.mock("@/lib/rbac/openfga-agent-authz", () => ({
  requireAgentUsePermission: (...args: unknown[]) => mockRequireAgentUsePermission(...args),
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
    expect(proxy.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        traceparent: expect.stringMatching(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/),
      }),
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

  it("keeps cancel authentication-only and does not call OpenFGA", async () => {
    const response = await cancelPost(
      jsonRequest("/api/v1/chat/stream/cancel", {
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(1);
    expect(mockRequireAgentUsePermission).not.toHaveBeenCalled();
    expect(mockProxyJSONRequest).toHaveBeenCalledTimes(1);
  });
});
