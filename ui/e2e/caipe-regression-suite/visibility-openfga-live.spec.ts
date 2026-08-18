import { caipeTapEnvOrSkip } from "./_env";
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

async function createAgent(
  page: Parameters<typeof api>[0],
  name: string,
  visibility: Visibility,
  teamSlug: string,
  allowedTools: Record<string, boolean> = {},
) {
  const result = await api(page, "/api/dynamic-agents", json("POST", {
    name,
    description: "CAIPE Regression Suite release fixture",
    system_prompt: "Return a short CAIPE Regression Suite acknowledgement.",
    model: { id: "gpt-4o-mini", provider: "openai" },
    visibility,
    ...(visibility === "team" ? { owner_team_slug: teamSlug } : {}),
    enabled: true,
    allowed_tools: allowedTools,
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { result, id: idFrom(result, ["_id", "id"]) };
}

async function createMcp(page: Parameters<typeof api>[0], input: { slug: string; name: string; visibility: Visibility; teamSlug: string; endpoint: string }) {
  const result = await api(page, "/api/mcp-servers", json("POST", {
    id: input.slug,
    name: input.name,
    description: "CAIPE Regression Suite release fixture",
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

test.describe("CAIPE Regression Suite visibility and OpenFGA projection", () => {
  for (const visibility of ["private", "team", "global"] as const) {
    test(`@smoke ${visibility} MCP and agent have exact OpenFGA grants`, async ({ page }, testInfo) => {
      const env = caipeTapEnvOrSkip();
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
        const agent = await createAgent(page, `${token}-agent`, visibility, env.teamSlug, { [mcp.id]: true });
        cleanup.push(`/api/dynamic-agents?id=${encodeURIComponent(agent.id)}`);

        const mcpObject = `mcp_server:${mcp.id}`;
        const agentObject = `agent:${agent.id}`;
        const personalOwnerTupleExpected = visibility === "private";
        // Team/global resources are owned by their team/organization policy.
        // Keeping a direct personal owner grant would bypass later membership
        // revocation, so the regression must assert that it is absent.
        await expectTuple(
          page,
          { user: `user:${env.admin.subject}`, relation: "owner", object: mcpObject },
          personalOwnerTupleExpected,
        );
        await expectTuple(
          page,
          { user: `user:${env.admin.subject}`, relation: "owner", object: agentObject },
          personalOwnerTupleExpected,
        );
        await expectTuple(page, { user: `agent:${agent.id}`, relation: "caller", object: `tool:${mcp.id}/*` });

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
    const env = caipeTapEnvOrSkip();
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
    const env = caipeTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const token = `${env.prefix}-credential-${testInfo.retry}`.slice(0, 110);
    const marker = `${token}-no-external-access`;
    let secretId = "";
    try {
      const created = await api(page, "/api/credentials/secrets", json("POST", {
        name: token,
        description: "CAIPE Regression Suite harmless marker credential",
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
    const env = caipeTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const token = `${env.prefix}-org-credential-${testInfo.retry}`.slice(0, 110);
    let secretId = "";
    try {
      const created = await api(page, "/api/credentials/secrets", json("POST", {
        name: token,
        description: "CAIPE Regression Suite organization marker credential",
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
    const env = caipeTapEnvOrSkip();
    await installPersona(page, env, "admin");
    const toolId = `${env.prefix}-search-${testInfo.retry}`.slice(0, 110);
    const path = `/api/rag/v1/mcp/custom-tools/${encodeURIComponent(toolId)}`;
    let created = false;
    try {
      const payload = {
        tool_id: toolId,
        description: "CAIPE Regression Suite synthetic knowledge-base search tool",
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
    const env = caipeTapEnvOrSkip();
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
        metadata: { caipe_regression_suite_run: env.runId },
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
