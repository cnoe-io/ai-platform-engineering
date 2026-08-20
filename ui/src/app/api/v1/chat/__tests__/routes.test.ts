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
const mockIsSchedulerTokenConfigured = jest.fn();
const mockIsSchedulerTokenValid = jest.fn();
const mockResolveScheduledRunContext = jest.fn();
const mockMintScheduledOwnerToken = jest.fn();

jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
  getDynamicAgentsConfig: (...args: unknown[]) => mockGetDynamicAgentsConfig(...args),
  proxySSEStream: (...args: unknown[]) => mockProxySSEStream(...args),
  proxyJSONRequest: (...args: unknown[]) => mockProxyJSONRequest(...args),
}));

jest.mock("@/lib/scheduled-run-auth", () => ({
  isSchedulerTokenConfigured: (...args: unknown[]) => mockIsSchedulerTokenConfigured(...args),
  isSchedulerTokenValid: (...args: unknown[]) => mockIsSchedulerTokenValid(...args),
  resolveScheduledRunContext: (...args: unknown[]) => mockResolveScheduledRunContext(...args),
  mintScheduledOwnerToken: (...args: unknown[]) => mockMintScheduledOwnerToken(...args),
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
  isMongoDBConfigured: true,
}));

function jsonRequest(
  path: string,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
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
    process.env.HARNESS_ENGINE_URL = "http://harness-engine:8010";
    process.env.HARNESS_ENGINE_INTERNAL_TOKEN = "internal-test-token";
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
    // Scheduled-run defaults: token configured + valid, owner resolves, mint ok.
    mockIsSchedulerTokenConfigured.mockReturnValue(true);
    mockIsSchedulerTokenValid.mockReturnValue(true);
    mockResolveScheduledRunContext.mockResolvedValue({
      sub: "owner-sub",
      email: "owner@example.com",
      agentId: "agent-persisted",
      scheduleTitle: "Persisted schedule title",
    });
    mockMintScheduledOwnerToken.mockResolvedValue("owner-bearer-token");
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

  it("keeps the legacy Dynamic Agents path free of harness lookups when Harness Engine is disabled", async () => {
    delete process.env.HARNESS_ENGINE_URL;
    delete process.env.HARNESS_ENGINE_INTERNAL_TOKEN;
    const requestedCollections: string[] = [];
    mockGetCollection.mockImplementation(async (name: string) => {
      requestedCollections.push(name);
      return {
        findOne: jest.fn(async () => ({
          _id: "conv-1",
          owner_id: "alice@example.com",
          owner_subject: "alice-sub",
        })),
      };
    });

    const response = await startPost(jsonRequest("/api/v1/chat/stream/start", {
      message: "hi",
      conversation_id: "conv-1",
      agent_id: "legacy-agent",
    }));

    expect(response.status).toBe(200);
    expect(requestedCollections).not.toContain("dynamic_agents");
    expect(mockProxySSEStream).toHaveBeenCalledWith(
      "http://dynamic-agents:8000/api/v1/chat/stream/start",
      expect.any(String),
      expect.any(Object),
      "[stream/start]",
    );
  });

  it("routes a legacy agent document without a harness marker to Dynamic Agents", async () => {
    mockGetCollection.mockImplementation(async (name: string) => ({
      findOne: jest.fn(async () => name === "dynamic_agents"
        ? { _id: "legacy-agent" }
        : {
            _id: "conv-1",
            owner_id: "alice@example.com",
            owner_subject: "alice-sub",
          }),
    }));

    const response = await startPost(jsonRequest("/api/v1/chat/stream/start", {
      message: "hi",
      conversation_id: "conv-1",
      agent_id: "legacy-agent",
    }));

    expect(response.status).toBe(200);
    expect(mockProxySSEStream).toHaveBeenCalledTimes(1);
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
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

  it.each(["browser", "slack", "webex"])(
    "routes %s AG-UI clients through Harness Engine when the agent selects AgentCore",
    async (clientSource) => {
      mockGetCollection.mockImplementation(async (name: string) => ({
        findOne: jest.fn(async () => name === "dynamic_agents"
          ? { _id: "agent-1", execution_harness_id: "agentcore" }
          : {
              _id: "conv-1",
              owner_id: "alice@example.com",
              owner_subject: "alice-sub",
              client_type: clientSource,
            }),
      }));
      const fetchMock = jest.spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({
          success: true,
          data: {
            run_id: "run-1",
            agent_id: "agent-1",
            conversation_id: "conv-1",
            agent_version: 1,
            binding_id: "binding-1",
            harness_id: "agentcore",
            profile_id: "primary",
            status: "queued",
            last_sequence: 0,
          },
        }), { status: 202, headers: { "Content-Type": "application/json" } }))
        .mockResolvedValueOnce(new Response(
          "id: 1\nevent: run.started\ndata: {}\n\n" +
          "id: 2\nevent: content.delta\ndata: {\"text\":\"hello\"}\n\n" +
          "id: 3\nevent: run.completed\ndata: {}\n\n",
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ));

      const response = await startPost(jsonRequest(
        "/api/v1/chat/stream/start",
        { message: "hi", conversation_id: "conv-1", agent_id: "agent-1", protocol: "agui" },
        { "X-Client-Source": clientSource },
      ));
      const stream = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Harness-ID")).toBe("agentcore");
      expect(stream).toContain("event: RUN_STARTED");
      expect(stream).toContain("event: TEXT_MESSAGE_CONTENT");
      expect(stream).toContain('"delta":"hello"');
      expect(stream).toContain("event: RUN_FINISHED");
      expect(mockProxySSEStream).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "http://harness-engine:8010/api/v1/runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer internal-test-token",
            "X-Harness-Engine-Subject": "alice-sub",
          }),
        }),
      );
    },
  );

  it("preserves CAIPE CLI context and AG-UI tool-result fields for provider harnesses", async () => {
    mockGetCollection.mockImplementation(async (name: string) => ({
      findOne: jest.fn(async () => name === "dynamic_agents"
        ? { _id: "agent-1", execution_harness_id: "claude_agent_sdk" }
        : { _id: "conv-1", owner_id: "alice@example.com", owner_subject: "alice-sub" }),
    }));
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          run_id: "run-cli",
          agent_id: "agent-1",
          conversation_id: "conv-1",
          agent_version: 1,
          binding_id: "binding-cli",
          harness_id: "claude_agent_sdk",
          profile_id: "safe",
          status: "queued",
          last_sequence: 0,
        },
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(
        "id: 1\nevent: run.started\ndata: {}\n\n" +
        "id: 2\nevent: tool.started\ndata: {\"tool_call_id\":\"tool-1\",\"tool_name\":\"search\",\"arguments\":{\"q\":\"hello\"}}\n\n" +
        "id: 3\nevent: tool.completed\ndata: {\"tool_call_id\":\"tool-1\",\"result\":\"found\"}\n\n" +
        "id: 4\nevent: run.completed\ndata: {}\n\n",
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ));

    const response = await startPost(jsonRequest("/api/v1/chat/stream/start", {
      message: "hi",
      context: "repository context from caipe-cli",
      conversation_id: "conv-1",
      agent_id: "agent-1",
      protocol: "agui",
    }));
    const stream = await response.text();
    const createRunBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;

    expect(createRunBody.context).toBe("repository context from caipe-cli");
    expect(stream).toContain("event: TOOL_CALL_RESULT");
    expect(stream).toContain('"toolCallId":"tool-1"');
    expect(stream).not.toContain('"tool_call_id":"tool-1"');
  });

  it("accumulates a Harness Engine run through the existing invoke contract", async () => {
    mockGetCollection.mockImplementation(async (name: string) => ({
      findOne: jest.fn(async () => name === "dynamic_agents"
        ? { _id: "agent-1", execution_harness_id: "claude_agent_sdk" }
        : { _id: "conv-1", owner_id: "alice@example.com", owner_subject: "alice-sub" }),
    }));
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          run_id: "run-2",
          agent_id: "agent-1",
          conversation_id: "conv-1",
          agent_version: 1,
          binding_id: "binding-1",
          harness_id: "claude_agent_sdk",
          profile_id: "safe",
          status: "queued",
          last_sequence: 0,
        },
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          run: { status: "completed" },
          events: [
            { run_id: "run-2", sequence: 1, event_type: "content.delta", data: { text: "hello" } },
            { run_id: "run-2", sequence: 2, event_type: "content.delta", data: { text: " world" } },
            { run_id: "run-2", sequence: 3, event_type: "run.completed", data: {} },
          ],
          next_cursor: 3,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await invokePost(jsonRequest("/api/v1/chat/invoke", {
      message: "hi",
      conversation_id: "conv-1",
      agent_id: "agent-1",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      content: "hello world",
      run_id: "run-2",
      agent_id: "agent-1",
      conversation_id: "conv-1",
    });
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("cancels the active harness run without clearing its session", async () => {
    mockGetCollection.mockImplementation(async (name: string) => ({
      findOne: jest.fn(async () => name === "dynamic_agents"
        ? { _id: "agent-1", execution_harness_id: "agentcore" }
        : { _id: "conv-1", owner_id: "alice@example.com", owner_subject: "alice-sub" }),
    }));
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { cancelled: true, run_id: "run-3" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await cancelPost(jsonRequest("/api/v1/chat/stream/cancel", {
      conversation_id: "conv-1",
      agent_id: "agent-1",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      cancelled: true,
      run_id: "run-3",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://harness-engine:8010/api/v1/runs/cancel-active",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("bypasses the conversation#write check for Slack conversations so any thread participant can invoke", async () => {
    // Slack threads are multi-participant. A non-owner (bob) must be able to
    // invoke the agent within the thread. agent#can_use is still enforced first;
    // the conversation#write ReBAC check is skipped for client_type === 'slack'.
    mockAuthenticateRequest.mockResolvedValue({
      subject: "bob-sub",
      email: "bob@example.com",
      tenantId: "default",
      bearerToken: "token",
    });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn(async () => ({
        _id: "conv-1",
        owner_id: "alice@example.com",
        owner_subject: "alice-sub",
        client_type: "slack",
      })),
    });

    const response = await startPost(
      jsonRequest("/api/v1/chat/stream/start", {
        message: "hi",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRequireAgentUsePermission).toHaveBeenCalledTimes(1);
    // The write check is short-circuited for Slack conversations.
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
    expect(mockProxySSEStream).toHaveBeenCalledTimes(1);
  });

  it("still enforces the conversation#write check for non-Slack conversations", async () => {
    // Regression guard: the Slack bypass must not leak to webui conversations.
    mockRequireConversationResourcePermission.mockRejectedValue(
      Object.assign(new Error("denied"), { statusCode: 403, code: "conversation#write" }),
    );
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn(async () => ({
        _id: "conv-1",
        owner_id: "alice@example.com",
        owner_subject: "alice-sub",
        client_type: "webui",
      })),
    });

    const response = await startPost(
      jsonRequest("/api/v1/chat/stream/start", {
        message: "hi",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledTimes(1);
    expect(mockProxySSEStream).not.toHaveBeenCalled();
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

  it("mints an owner bearer and enforces agent#use as the owner for scheduler-token invoke runs", async () => {
    const findOne = jest.fn(async () => null);
    const updateOne = jest.fn(async () => ({ acknowledged: true }));
    const countDocuments = jest.fn(async () => 1);
    mockGetCollection.mockImplementation(async (name: string) => name === "dynamic_agents"
      ? {
          findOne: jest.fn(async () => ({
            _id: "agent-persisted",
            execution_harness_id: "dynamic_agents",
          })),
        }
      : { findOne, updateOne, countDocuments });

    const response = await invokePost(
      jsonRequest(
        "/api/v1/chat/invoke",
        {
          message: "run scheduled prep",
          conversation_id: "scheduled-sched_123-run_456",
          agent_id: "agent-1",
          owner_user_id: "owner@example.com",
          trace_id: "scheduled-sched_123-run_456",
          client_context: {
            source: "scheduler",
            schedule_id: "sched_123",
            schedule_title: "Daily platform report",
          },
        },
        {
          "X-Scheduler-Token": "service-token",
          "X-Client-Source": "caipe-cron-runner",
        },
      ),
    );

    expect(response.status).toBe(200);
    // The interactive session auth path is NOT used for scheduled runs.
    expect(mockAuthenticateRequest).not.toHaveBeenCalled();
    // Owner is resolved from the schedule DB record (by schedule_id), and a
    // real owner bearer is minted via Keycloak token exchange.
    expect(mockResolveScheduledRunContext).toHaveBeenCalledWith("sched_123");
    expect(mockMintScheduledOwnerToken).toHaveBeenCalledWith("owner-sub");
    // agent#use IS enforced as the owner (no scheduled-run authz bypass).
    expect(mockRequireAgentUsePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "owner-sub",
        agentId: "agent-persisted",
        email: "owner@example.com",
        isServiceAccount: false,
      }),
    );
    // The interactive conversation-write gate is skipped (the route owns the
    // idempotent scheduled-conversation creation).
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
    expect(mockProxyJSONRequest).toHaveBeenCalledTimes(1);
    expect(mockProxyJSONRequest.mock.calls[0][0]).toBe("http://dynamic-agents:8000/api/v1/chat/invoke");
    // The owner bearer (not a shared token) is forwarded to Dynamic Agents.
    expect(mockProxyJSONRequest.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        subject: "owner-sub",
        bearerToken: "owner-bearer-token",
        traceparent: expect.stringMatching(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/),
      }),
    );

    const proxiedBody = JSON.parse(mockProxyJSONRequest.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(proxiedBody.conversation_id).not.toBe("scheduled-sched_123-run_456");
    expect(proxiedBody.conversation_id).toEqual(expect.any(String));
    expect(proxiedBody.agent_id).toBe("agent-persisted");
    expect(proxiedBody.owner_user_id).toBe("owner@example.com");
    expect(proxiedBody.client_context).toEqual(
      expect.objectContaining({
        source: "scheduler",
        schedule_id: "sched_123",
        schedule_title: "Persisted schedule title",
        run_id: "scheduled-sched_123-run_456",
        actor_client_id: "caipe-scheduler-runner",
      }),
    );
    expect(updateOne).toHaveBeenCalled();
    expect(countDocuments).toHaveBeenCalled();
  });

  it("fails a scheduler-token invoke closed when the owner cannot be resolved", async () => {
    mockResolveScheduledRunContext.mockResolvedValue(null);

    const response = await invokePost(
      jsonRequest(
        "/api/v1/chat/invoke",
        {
          message: "run scheduled prep",
          conversation_id: "scheduled-sched_123-run_456",
          agent_id: "agent-1",
          client_context: { source: "scheduler", schedule_id: "sched_123" },
        },
        {
          "X-Scheduler-Token": "service-token",
          "X-Client-Source": "caipe-cron-runner",
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(mockMintScheduledOwnerToken).not.toHaveBeenCalled();
    expect(mockRequireAgentUsePermission).not.toHaveBeenCalled();
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("fails a scheduler-token invoke closed on a scheduled conversation owner mismatch", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "existing-conversation",
        idempotency_key: "scheduler:scheduled-sched_123-run_456",
        owner_id: "different-owner@example.com",
        owner_subject: "different-owner-sub",
      }),
    });

    const response = await invokePost(
      jsonRequest(
        "/api/v1/chat/invoke",
        {
          message: "run scheduled report",
          conversation_id: "scheduled-sched_123-run_456",
          agent_id: "caller-controlled-agent",
          client_context: { source: "scheduler", schedule_id: "sched_123" },
        },
        { "X-Scheduler-Token": "service-token" },
      ),
    );

    expect(response.status).toBe(502);
    expect(mockRequireAgentUsePermission).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-persisted" }),
    );
    expect(mockProxyJSONRequest).not.toHaveBeenCalled();
  });

  it("rejects a scheduler-token invoke with an invalid scheduler token", async () => {
    mockIsSchedulerTokenValid.mockReturnValue(false);

    const response = await invokePost(
      jsonRequest(
        "/api/v1/chat/invoke",
        {
          message: "run scheduled prep",
          conversation_id: "scheduled-sched_123-run_456",
          agent_id: "agent-1",
          client_context: { source: "scheduler", schedule_id: "sched_123" },
        },
        { "X-Scheduler-Token": "wrong-token" },
      ),
    );

    expect(response.status).toBe(401);
    expect(mockResolveScheduledRunContext).not.toHaveBeenCalled();
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
