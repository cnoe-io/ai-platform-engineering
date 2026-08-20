import { gridTapEnvOrSkip } from "./_env";
import {
  api,
  attachEvidence,
  bestEffortDelete,
  dataRecord,
  evidenceScreenshot,
  expect,
  expectDecision,
  expectTuple,
  idFrom,
  installPersona,
  json,
  test,
} from "./_helpers";

type Visibility = "private" | "team" | "global";
type AllowedTools = Record<string, string[] | boolean>;

type AgentExecution = {
  status: number;
  contentType: string;
  body: string;
};

async function createAgent(
  page: Parameters<typeof api>[0],
  name: string,
  visibility: Visibility,
  teamSlug: string,
  allowedTools: AllowedTools = {},
  invocation?: { toolName: string; params: Record<string, unknown>; model: { id: string; provider: string } },
) {
  const result = await api(page, "/api/dynamic-agents", json("POST", {
    name,
    description: "GRID TAP release fixture",
    system_prompt: invocation
      ? `For every request, call the configured MCP tool whose name ends with "${invocation.toolName}" exactly once with these arguments: ${JSON.stringify(invocation.params)}. Do not answer from memory. After the tool returns, respond GRID TAP AGENT INVOKED.`
      : "Return a short GRID TAP acknowledgement.",
    model: invocation?.model ?? { id: "gpt-4o-mini", provider: "openai" },
    visibility,
    ...(visibility === "team" ? { owner_team_slug: teamSlug } : {}),
    enabled: true,
    allowed_tools: allowedTools,
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { result, id: idFrom(result, ["_id", "id"]) };
}

async function createConversation(page: Parameters<typeof api>[0], title: string, agentId: string, runId: string): Promise<string> {
  const result = await api(page, "/api/chat/conversations", json("POST", {
    title,
    client_type: "webui",
    agent_id: agentId,
    metadata: { grid_tap_run: runId },
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  const data = dataRecord(result);
  const nested = typeof data.conversation === "object" && data.conversation !== null
    ? data.conversation as Record<string, unknown>
    : data;
  const id = String(nested._id || nested.id || "");
  expect(id).not.toBe("");
  return id;
}

async function invokeMcpTool(
  page: Parameters<typeof api>[0],
  serverId: string,
  toolName: string,
  params: Record<string, unknown>,
) {
  return api(page, "/api/mcp-servers/test-tool", json("POST", { serverId, toolName, params }));
}

async function invokeAgent(
  page: Parameters<typeof api>[0],
  agentId: string,
  conversationId: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<AgentExecution> {
  return page.evaluate(async (input) => {
    const response = await fetch("/api/v1/chat/stream/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Call ${input.toolName} now with exactly these arguments: ${JSON.stringify(input.params)}. Return GRID TAP AGENT INVOKED after the result.`,
        conversation_id: input.conversationId,
        agent_id: input.agentId,
        protocol: "custom",
        client_context: { source: "webui" },
      }),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body: await response.text(),
    };
  }, { agentId, conversationId, toolName, params });
}

function compactDirectEvidence(result: Awaited<ReturnType<typeof invokeMcpTool>>) {
  const data = dataRecord(result);
  return {
    status: result.status,
    success: data.success,
    application_success: data.application_success,
    tool_name: data.tool_name,
    result_preview: JSON.stringify(data.result ?? result.body).slice(0, 800),
  };
}

function compactAgentEvidence(result: AgentExecution, toolName: string) {
  return {
    status: result.status,
    content_type: result.contentType,
    tool_name: toolName,
    tool_start: /event:\s*tool_start/i.test(result.body),
    tool_end: /event:\s*tool_end/i.test(result.body),
    done: /event:\s*done/i.test(result.body),
    error: /event:\s*error/i.test(result.body),
    stream_preview: result.body.slice(0, 1_200),
  };
}

function expectSuccessfulDirectInvocation(result: Awaited<ReturnType<typeof invokeMcpTool>>): void {
  const data = dataRecord(result);
  expect.soft(result.status, JSON.stringify(result.body)).toBe(200);
  expect.soft(data.success, JSON.stringify(result.body)).toBe(true);
  expect.soft(data.application_success, JSON.stringify(result.body)).toBe(true);
}

function expectSuccessfulAgentInvocation(result: AgentExecution, toolName: string): void {
  expect.soft(result.status, result.body).toBe(200);
  expect.soft(result.contentType, result.body).toContain("text/event-stream");
  expect.soft(result.body, result.body).toMatch(/event:\s*tool_start/i);
  expect.soft(result.body, result.body).toContain(toolName);
  expect.soft(result.body, result.body).toMatch(/event:\s*tool_end/i);
  expect.soft(result.body, result.body).toMatch(/event:\s*done/i);
  expect.soft(result.body, result.body).not.toMatch(/event:\s*error/i);
}

async function createMcp(page: Parameters<typeof api>[0], input: { slug: string; name: string; visibility: Visibility; teamSlug: string; endpoint: string }) {
  const result = await api(page, "/api/mcp-servers", json("POST", {
    id: input.slug,
    name: input.name,
    description: "GRID TAP release fixture",
    transport: "http",
    endpoint: input.endpoint,
    visibility: input.visibility,
    ...(input.visibility === "team" ? { owner_team_slug: input.teamSlug } : {}),
    enabled: true,
    credential_sources: [],
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { result, id: idFrom(result, ["_id", "id"]) };
}

test.describe("GRID TAP visibility and OpenFGA projection", () => {
  for (const visibility of ["private", "team", "global"] as const) {
    test(`@smoke ${visibility} MCP and agent execute with exact OpenFGA grants`, async ({ page }, testInfo) => {
      const env = gridTapEnvOrSkip();
      await installPersona(page, env, "admin");
      const token = `${env.prefix}-${visibility}-${testInfo.retry}`.slice(0, 110);
      const cleanup: string[] = [];
      try {
        const mcp = await createMcp(page, {
          slug: token,
          name: `${token}-mcp`,
          visibility,
          teamSlug: env.teamSlug,
          endpoint: env.mcpEndpoint,
        });
        cleanup.push(`/api/mcp-servers?id=${encodeURIComponent(mcp.id)}`);
        const agent = await createAgent(
          page,
          `${token}-agent`,
          visibility,
          env.teamSlug,
          { [env.mcpServerId]: [env.mcpToolName] },
          { toolName: env.mcpToolName, params: env.mcpToolParams, model: env.agentModel },
        );
        cleanup.push(`/api/dynamic-agents?id=${encodeURIComponent(agent.id)}`);

        const mcpObject = `mcp_server:${mcp.id}`;
        const agentObject = `agent:${agent.id}`;
        const executionEvidence: Record<string, unknown> = {};

        const configuredDirect = await invokeMcpTool(page, env.mcpServerId, env.mcpToolName, env.mcpToolParams);
        executionEvidence.configured_direct_mcp = compactDirectEvidence(configuredDirect);
        expectSuccessfulDirectInvocation(configuredDirect);

        const adminDirect = await invokeMcpTool(page, mcp.id, env.mcpToolName, env.mcpToolParams);
        executionEvidence.admin_direct_mcp = compactDirectEvidence(adminDirect);
        expectSuccessfulDirectInvocation(adminDirect);

        if (visibility === "private") {
          const conversationId = await createConversation(page, `${token}-admin-execution`, agent.id, env.runId);
          cleanup.push(`/api/chat/conversations/${encodeURIComponent(conversationId)}`);
          const adminAgent = await invokeAgent(page, agent.id, conversationId, env.mcpToolName, env.mcpToolParams);
          executionEvidence.admin_agent = compactAgentEvidence(adminAgent, env.mcpToolName);
          expectSuccessfulAgentInvocation(adminAgent, env.mcpToolName);
        }

        await installPersona(page, env, "member");
        const memberDirect = await invokeMcpTool(page, mcp.id, env.mcpToolName, env.mcpToolParams);
        executionEvidence.member_direct_mcp = compactDirectEvidence(memberDirect);

        if (visibility === "private") {
          expect.soft([403, 404], JSON.stringify(memberDirect.body)).toContain(memberDirect.status);
          const ownerConversationPath = cleanup.find((path) => path.startsWith("/api/chat/conversations/"));
          expect(ownerConversationPath).toBeTruthy();
          const ownerConversationId = decodeURIComponent(ownerConversationPath!.split("/").pop()!);
          const deniedAgent = await invokeAgent(page, agent.id, ownerConversationId, env.mcpToolName, env.mcpToolParams);
          executionEvidence.member_agent = compactAgentEvidence(deniedAgent, env.mcpToolName);
          expect.soft([403, 404], deniedAgent.body).toContain(deniedAgent.status);
        } else {
          if (visibility === "team") {
            expectSuccessfulDirectInvocation(memberDirect);
          } else {
            expect.soft([403, 404], JSON.stringify(memberDirect.body)).toContain(memberDirect.status);
          }
          const conversationId = await createConversation(page, `${token}-member-execution`, agent.id, env.runId);
          const memberConversationPath = `/api/chat/conversations/${encodeURIComponent(conversationId)}`;
          const memberAgent = await invokeAgent(page, agent.id, conversationId, env.mcpToolName, env.mcpToolParams);
          executionEvidence.member_agent = compactAgentEvidence(memberAgent, env.mcpToolName);
          expectSuccessfulAgentInvocation(memberAgent, env.mcpToolName);
          await bestEffortDelete(page, [memberConversationPath]);
        }

        await installPersona(page, env, "admin");
        await attachEvidence(testInfo, "execution-evidence", { visibility, ...executionEvidence });
        await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "owner", object: mcpObject });
        await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "owner", object: agentObject });
        await expectTuple(page, {
          user: `agent:${agent.id}`,
          relation: "caller",
          object: `tool:${env.mcpServerId}/${env.mcpToolName}`,
        });

        if (visibility === "private") {
          await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object: mcpObject }, false);
          await expectTuple(page, { user: "user:*", relation: "user", object: agentObject }, false);
          await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: mcp.id, action: "read" }, "DENY");
          await expectDecision(page, { subject: env.member.subject, type: "agent", id: agent.id, action: "use" }, "DENY");
        } else if (visibility === "team") {
          for (const relation of ["reader", "user", "invoker"] as const) {
            await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation, object: mcpObject });
          }
          await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object: agentObject });
          await expectTuple(page, { user: "user:*", relation: "user", object: agentObject }, false);
          await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: mcp.id, action: "read" }, "ALLOW");
          await expectDecision(page, { subject: env.member.subject, type: "agent", id: agent.id, action: "use" }, "ALLOW");
        } else {
          await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "reader", object: mcpObject });
          await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "user", object: mcpObject });
          await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "invoker", object: mcpObject }, false);
          await expectTuple(page, { user: "user:*", relation: "user", object: agentObject });
          await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: mcp.id, action: "read" }, "ALLOW");
          await expectDecision(page, { subject: env.member.subject, type: "agent", id: agent.id, action: "use" }, "ALLOW");
        }

        await attachEvidence(testInfo, "resource-manifest", { visibility, mcp, agent });
        await page.goto("/dynamic-agents", { waitUntil: "domcontentloaded" });
        await evidenceScreenshot(page, testInfo, `${visibility}-resources`);
      } finally {
        await installPersona(page, env, "admin");
        await bestEffortDelete(page, cleanup);
      }
    });
  }

  test("private → team → global → private revokes stale OpenFGA tuples", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const token = `${env.prefix}-transition-${testInfo.retry}`.slice(0, 110);
    const agent = await createAgent(page, `${token}-agent`, "private", env.teamSlug);
    const cleanup = [`/api/dynamic-agents?id=${encodeURIComponent(agent.id)}`];
    const object = `agent:${agent.id}`;
    try {
      await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "owner", object });
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object }, false);
      await expectTuple(page, { user: "user:*", relation: "user", object }, false);
      await evidenceScreenshot(page, testInfo, "transition-private");

      let update = await api(page, `/api/dynamic-agents?id=${encodeURIComponent(agent.id)}`, json("PUT", {
        visibility: "team", owner_team_slug: env.teamSlug, shared_with_teams: [],
      }));
      expect(update.status, JSON.stringify(update.body)).toBe(200);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object });
      await expectTuple(page, { user: "user:*", relation: "user", object }, false);
      await expectDecision(page, { subject: env.member.subject, type: "agent", id: agent.id, action: "use" }, "ALLOW");
      await evidenceScreenshot(page, testInfo, "transition-team");

      update = await api(page, `/api/dynamic-agents?id=${encodeURIComponent(agent.id)}`, json("PUT", {
        visibility: "global", owner_team_slug: env.teamSlug, shared_with_teams: [],
      }));
      expect(update.status, JSON.stringify(update.body)).toBe(200);
      await expectTuple(page, { user: "user:*", relation: "user", object });
      await evidenceScreenshot(page, testInfo, "transition-global");

      update = await api(page, `/api/dynamic-agents?id=${encodeURIComponent(agent.id)}`, json("PUT", {
        visibility: "private", owner_team_slug: null, shared_with_teams: [],
      }));
      expect(update.status, JSON.stringify(update.body)).toBe(200);
      await expectTuple(page, { user: "user:*", relation: "user", object }, false);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object }, false);
      await expectDecision(page, { subject: env.member.subject, type: "agent", id: agent.id, action: "use" }, "DENY");
      await attachEvidence(testInfo, "transition-final", dataRecord(update));
      await evidenceScreenshot(page, testInfo, "transition-private-restored");
    } finally {
      await installPersona(page, env, "admin");
      await bestEffortDelete(page, cleanup);
    }
  });

  test("private credential can be team-shared and revoked with exact OpenFGA evidence", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const token = `${env.prefix}-credential-${testInfo.retry}`.slice(0, 110);
    const marker = `${token}-no-external-access`;
    let secretId = "";
    try {
      const created = await api(page, "/api/credentials/secrets", json("POST", {
        name: token,
        description: "GRID TAP harmless marker credential",
        type: "custom",
        value: marker,
      }));
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(JSON.stringify(created.body)).not.toContain(marker);
      secretId = idFrom(created, ["id"]);
      const object = `secret_ref:${secretId}`;
      await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "owner", object });
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object }, false);
      await expectDecision(page, { subject: env.member.subject, type: "secret_ref", id: secretId, action: "use" }, "DENY");
      await page.goto("/credentials#secrets", { waitUntil: "domcontentloaded" });
      await evidenceScreenshot(page, testInfo, "credential-private");

      const shared = await api(page, `/api/credentials/secrets/${encodeURIComponent(secretId)}`, json("PATCH", {
        action: "share", teamId: env.teamSlug,
      }));
      expect(shared.status, JSON.stringify(shared.body)).toBe(200);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "metadata_reader", object });
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object });
      await expectDecision(page, { subject: env.member.subject, type: "secret_ref", id: secretId, action: "use" }, "ALLOW");
      await evidenceScreenshot(page, testInfo, "credential-team-shared");

      const revoked = await api(page, `/api/credentials/secrets/${encodeURIComponent(secretId)}`, json("PATCH", {
        action: "revoke", teamId: env.teamSlug,
      }));
      expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "metadata_reader", object }, false);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object }, false);
      await expectDecision(page, { subject: env.member.subject, type: "secret_ref", id: secretId, action: "use" }, "DENY");
      await attachEvidence(testInfo, "credential-share-revoke", { secretId, team: env.teamSlug });
      await evidenceScreenshot(page, testInfo, "credential-revoked");
    } finally {
      if (secretId) {
        await installPersona(page, env, "admin");
        await bestEffortDelete(page, [`/api/credentials/secrets/${encodeURIComponent(secretId)}`]);
      }
    }
  });

  test("organization credential grants use but not management to a non-admin", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const token = `${env.prefix}-org-credential-${testInfo.retry}`.slice(0, 110);
    let secretId = "";
    try {
      const created = await api(page, "/api/credentials/secrets", json("POST", {
        name: token,
        description: "GRID TAP organization marker credential",
        type: "custom",
        value: `${token}-no-external-access`,
        ownerType: "organization",
        ownerId: env.orgKey,
      }));
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      secretId = idFrom(created, ["id"]);
      const object = `secret_ref:${secretId}`;
      await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "metadata_reader", object });
      await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "user", object });
      await expectTuple(page, { user: `organization:${env.orgKey}#admin`, relation: "manager", object });
      await expectDecision(page, { subject: env.member.subject, type: "secret_ref", id: secretId, action: "use" }, "ALLOW");
      await expectDecision(page, { subject: env.member.subject, type: "secret_ref", id: secretId, action: "manage" }, "DENY");
      await attachEvidence(testInfo, "organization-credential", { secretId, org: env.orgKey });
      await page.goto("/credentials#secrets", { waitUntil: "domcontentloaded" });
      await evidenceScreenshot(page, testInfo, "credential-organization");
    } finally {
      if (secretId) {
        await installPersona(page, env, "admin");
        await bestEffortDelete(page, [`/api/credentials/secrets/${encodeURIComponent(secretId)}`]);
      }
    }
  });

  test("KB custom search tool reconciles team and organization call grants", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const toolId = `${env.prefix}-search-${testInfo.retry}`.slice(0, 110);
    const path = `/api/rag/v1/mcp/custom-tools/${encodeURIComponent(toolId)}`;
    let created = false;
    try {
      const payload = {
        tool_id: toolId,
        description: "GRID TAP synthetic knowledge-base search tool",
        parallel_searches: [{ label: "results", datasource_ids: [], extra_filters: {}, semantic_weight: 0.5 }],
        allow_runtime_filters: false,
        enabled: true,
        owner_team_slug: env.teamSlug,
        shared_with_teams: [],
        shared_with_org: false,
      };
      const response = await api(page, "/api/rag/v1/mcp/custom-tools", json("POST", payload));
      if (response.status === 401 && /invalid|expired/i.test(JSON.stringify(response.body))) {
        test.skip(true, "RAG rejected the synthetic production session; run this row with the real Safari session.");
      }
      expect([200, 201], JSON.stringify(response.body)).toContain(response.status);
      created = true;
      const object = `mcp_tool:${toolId}`;
      for (const relation of ["reader", "user", "caller"] as const) {
        await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation, object });
        await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation, object }, false);
      }
      await page.goto("/knowledge-bases/mcp-tools", { waitUntil: "domcontentloaded" });
      await evidenceScreenshot(page, testInfo, "kb-tool-team");

      const global = await api(page, path, json("PUT", { ...payload, shared_with_org: true }));
      expect(global.status, JSON.stringify(global.body)).toBe(200);
      for (const relation of ["reader", "user", "caller"] as const) {
        await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation, object });
      }
      await evidenceScreenshot(page, testInfo, "kb-tool-global");

      const teamOnly = await api(page, path, json("PUT", { ...payload, shared_with_org: false }));
      expect(teamOnly.status, JSON.stringify(teamOnly.body)).toBe(200);
      for (const relation of ["reader", "user", "caller"] as const) {
        await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation, object }, false);
      }
      await attachEvidence(testInfo, "kb-tool-sharing", { toolId, team: env.teamSlug, org: env.orgKey });
      await evidenceScreenshot(page, testInfo, "kb-tool-global-revoked");
    } finally {
      if (created) {
        await installPersona(page, env, "admin");
        await bestEffortDelete(page, [path]);
      }
    }
  });

  test("new chat team share writes reader/writer tuples and revoke removes them", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const token = `${env.prefix}-chat-${testInfo.retry}`.slice(0, 110);
    let agentId = "";
    let conversationId = "";
    try {
      const agent = await createAgent(page, `${token}-agent`, "team", env.teamSlug);
      agentId = agent.id;
      const conversation = await api(page, "/api/chat/conversations", json("POST", {
        title: token,
        client_type: "webui",
        agent_id: agentId,
        metadata: { grid_tap_run: env.runId },
      }));
      expect(conversation.status, JSON.stringify(conversation.body)).toBe(201);
      const conversationData = dataRecord(conversation);
      const nested = typeof conversationData.conversation === "object" && conversationData.conversation !== null
        ? conversationData.conversation as Record<string, unknown>
        : conversationData;
      conversationId = String(nested._id || nested.id || "");
      expect(conversationId).not.toBe("");

      const object = `conversation:${conversationId}`;
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "reader", object }, false);
      const shared = await api(page, `/api/chat/conversations/${conversationId}/share`, json("POST", {
        team_ids: [env.teamSlug], permission: "comment",
      }));
      expect(shared.status, JSON.stringify(shared.body)).toBe(200);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "reader", object });
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "writer", object });
      await installPersona(page, env, "member");
      const memberRead = await api(page, `/api/chat/conversations/${conversationId}`);
      expect(memberRead.status, JSON.stringify(memberRead.body)).toBe(200);
      await page.goto(`/chat/${conversationId}`, { waitUntil: "domcontentloaded" });
      await evidenceScreenshot(page, testInfo, "chat-team-shared");

      await installPersona(page, env, "admin");
      const revoked = await api(page, `/api/chat/conversations/${conversationId}/share`, json("DELETE", { team_id: env.teamSlug }));
      expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "reader", object }, false);
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "writer", object }, false);
      await installPersona(page, env, "member");
      const denied = await api(page, `/api/chat/conversations/${conversationId}`);
      expect([403, 404], JSON.stringify(denied.body)).toContain(denied.status);
      await attachEvidence(testInfo, "chat-share-revoke", { conversationId, agentId, team: env.teamSlug });
      await evidenceScreenshot(page, testInfo, "chat-team-revoked");
    } finally {
      await installPersona(page, env, "admin");
      const paths = [
        ...(agentId ? [`/api/dynamic-agents?id=${encodeURIComponent(agentId)}`] : []),
        ...(conversationId ? [`/api/chat/conversations/${encodeURIComponent(conversationId)}`] : []),
      ];
      await bestEffortDelete(page, paths);
    }
  });
});
