import { gridTapEnvOrSkip } from "./_env";
import {
  api,
  attachEvidence,
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
type Persona = "admin" | "member";

type Fixture = {
  owner: Persona;
  visibility: Visibility;
  credentialId: string;
  mcpId: string;
  agentId: string;
  nameToken: string;
};

async function createCredential(
  page: Parameters<typeof api>[0],
  name: string,
  owner?: { type: "organization"; id: string },
) {
  const marker = `${name}-harmless-marker`;
  const result = await api(page, "/api/credentials/secrets", json("POST", {
    name,
    description: "GRID TAP harmless marker credential",
    type: "custom",
    value: marker,
    ...(owner ? { ownerType: owner.type, ownerId: owner.id } : {}),
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  expect(JSON.stringify(result.body)).not.toContain(marker);
  return idFrom(result, ["id"]);
}

async function createMcp(
  page: Parameters<typeof api>[0],
  input: {
    nameToken: string;
    visibility: Visibility;
    teamSlug: string;
    endpoint: string;
    credentialId: string;
  },
) {
  const result = await api(page, "/api/mcp-servers", json("POST", {
    id: `${input.nameToken}-mcp`,
    name: `${input.nameToken}-mcp`,
    description: "GRID TAP authorization fixture",
    transport: "http",
    endpoint: input.endpoint,
    visibility: input.visibility,
    ...(input.visibility === "team" ? { owner_team_slug: input.teamSlug } : {}),
    enabled: true,
    credential_sources: [{
      kind: "secret_ref",
      target: "header",
      name: "X-GRID-TAP-Marker",
      secret_ref: input.credentialId,
    }],
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { id: idFrom(result, ["_id", "id"]), body: dataRecord(result) };
}

async function createAgent(
  page: Parameters<typeof api>[0],
  input: { nameToken: string; visibility: Visibility; teamSlug: string; mcpId: string },
) {
  const result = await api(page, "/api/dynamic-agents", json("POST", {
    name: `${input.nameToken}-agent`,
    description: "GRID TAP authorization fixture",
    system_prompt: "Return a short acknowledgement.",
    model: { id: "gpt-4o-mini", provider: "openai" },
    visibility: input.visibility,
    ...(input.visibility === "team" ? { owner_team_slug: input.teamSlug } : {}),
    enabled: true,
    allowed_tools: { [input.mcpId]: true },
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { id: idFrom(result, ["_id", "id"]), body: dataRecord(result) };
}

async function createFixture(
  page: Parameters<typeof api>[0],
  input: {
    owner: Persona;
    nameToken: string;
    visibility: Visibility;
    teamSlug: string;
    endpoint: string;
    credentialOwner?: { type: "organization"; id: string };
  },
): Promise<Fixture> {
  const credentialId = await createCredential(page, `${input.nameToken}-credential`, input.credentialOwner);
  if (input.visibility === "team") {
    const shared = await api(
      page,
      `/api/credentials/secrets/${encodeURIComponent(credentialId)}`,
      json("PATCH", { action: "share", teamId: input.teamSlug }),
    );
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
  }
  const mcp = await createMcp(page, { ...input, credentialId });
  const agent = await createAgent(page, { ...input, mcpId: mcp.id });
  expect(String(mcp.body.agentgateway_endpoint ?? mcp.body.endpoint ?? "")).toContain("agentgateway");
  return {
    owner: input.owner,
    visibility: input.visibility,
    credentialId,
    mcpId: mcp.id,
    agentId: agent.id,
    nameToken: input.nameToken,
  };
}

async function expectPrivateProjection(
  page: Parameters<typeof api>[0],
  fixture: Fixture,
  ownerSubject: string,
  otherSubject: string,
  teamSlug: string,
  orgKey: string,
) {
  const mcpObject = `mcp_server:${fixture.mcpId}`;
  const agentObject = `agent:${fixture.agentId}`;
  const secretObject = `secret_ref:${fixture.credentialId}`;
  for (const object of [mcpObject, agentObject, secretObject]) {
    await expectTuple(page, { user: `user:${ownerSubject}`, relation: "owner", object });
  }
  await expectTuple(page, { user: `user:${ownerSubject}`, relation: "creator", object: mcpObject });
  await expectTuple(page, { user: `user:${ownerSubject}`, relation: "creator", object: agentObject });
  await expectTuple(page, { user: `organization:${orgKey}#admin`, relation: "private_marker", object: mcpObject }, false);
  for (const relation of ["reader", "user", "invoker", "manager"] as const) {
    await expectTuple(page, { user: `team:${teamSlug}#member`, relation, object: mcpObject }, false);
    await expectTuple(page, { user: `organization:${orgKey}#member`, relation, object: mcpObject }, false);
  }
  await expectTuple(page, { user: `agent:${fixture.agentId}`, relation: "caller", object: `tool:${fixture.mcpId}/*` });
  // The generic CAS endpoint has no trusted Web/DM interaction proof, so a
  // context-free private-resource decision is denied even for the owner. The
  // protected BFF routes below provide the trusted Web context and must allow
  // the owner while still denying the other identity.
  await expectDecision(page, { subject: ownerSubject, type: "mcp_server", id: fixture.mcpId, action: "invoke" }, "DENY");
  await expectDecision(page, { subject: ownerSubject, type: "agent", id: fixture.agentId, action: "use" }, "DENY");
  await expectDecision(page, { subject: ownerSubject, type: "secret_ref", id: fixture.credentialId, action: "use" }, "DENY");
  await expectDecision(page, { subject: otherSubject, type: "mcp_server", id: fixture.mcpId, action: "read" }, "DENY");
  await expectDecision(page, { subject: otherSubject, type: "mcp_server", id: fixture.mcpId, action: "invoke" }, "DENY");
  await expectDecision(page, { subject: otherSubject, type: "agent", id: fixture.agentId, action: "use" }, "DENY");
  await expectDecision(page, { subject: otherSubject, type: "secret_ref", id: fixture.credentialId, action: "use" }, "DENY");
}

async function expectDirectPrivateAccess(
  page: Parameters<typeof api>[0],
  fixture: Fixture,
  ownerPersona: Persona,
  otherPersona: Persona,
  env: ReturnType<typeof gridTapEnvOrSkip>,
) {
  await installPersona(page, env, ownerPersona);
  for (const path of [
    `/api/mcp-servers?id=${encodeURIComponent(fixture.mcpId)}`,
    `/api/dynamic-agents/agents/${encodeURIComponent(fixture.agentId)}`,
    `/api/credentials/secrets/${encodeURIComponent(fixture.credentialId)}`,
  ]) {
    const visible = await api(page, path);
    expect(visible.status, `${path}: ${JSON.stringify(visible.body)}`).toBe(200);
  }
  const ownerContext = await api(page, "/api/mcp-servers/agent-context", json("POST", { serverIds: [fixture.mcpId] }));
  expect(ownerContext.status, JSON.stringify(ownerContext.body)).toBe(200);

  await installPersona(page, env, otherPersona);
  for (const path of [
    `/api/mcp-servers?id=${encodeURIComponent(fixture.mcpId)}`,
    `/api/dynamic-agents/agents/${encodeURIComponent(fixture.agentId)}`,
    `/api/credentials/secrets/${encodeURIComponent(fixture.credentialId)}`,
  ]) {
    const hidden = await api(page, path);
    expect([403, 404], `${path}: ${JSON.stringify(hidden.body)}`).toContain(hidden.status);
  }
  const deniedContext = await api(page, "/api/mcp-servers/agent-context", json("POST", { serverIds: [fixture.mcpId] }));
  expect(deniedContext.status, JSON.stringify(deniedContext.body)).toBe(403);
}

test.describe("GRID TAP mutual private, shared-team, and global resources", () => {
  test("creates mirrored fixtures and validates tuples, CAS, and protected APIs", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    const base = `${env.prefix}-mutual-${testInfo.retry}`.slice(0, 78);
    const fixtures: Fixture[] = [];

    await installPersona(page, env, "admin");
    const adminPrivate = await createFixture(page, {
      owner: "admin",
      nameToken: `${base}-admin-private`,
      visibility: "private",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
    });
    fixtures.push(adminPrivate);
    await expectPrivateProjection(page, adminPrivate, env.admin.subject, env.member.subject, env.teamSlug, env.orgKey);
    await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
    await evidenceScreenshot(page, testInfo, "admin-private-created");

    await installPersona(page, env, "member");
    const memberPrivate = await createFixture(page, {
      owner: "member",
      nameToken: `${base}-member-private`,
      visibility: "private",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
    });
    fixtures.push(memberPrivate);

    await installPersona(page, env, "admin");
    await expectPrivateProjection(page, memberPrivate, env.member.subject, env.admin.subject, env.teamSlug, env.orgKey);
    await expectDirectPrivateAccess(page, adminPrivate, "admin", "member", env);
    await expectDirectPrivateAccess(page, memberPrivate, "member", "admin", env);
    await evidenceScreenshot(page, testInfo, "mutual-private-denial");

    await installPersona(page, env, "admin");
    const crossOwnerMcp = await api(page, "/api/mcp-servers", json("POST", {
      id: `${base}-cross-owner-mcp`,
      name: `${base}-cross-owner-mcp`,
      transport: "http",
      endpoint: env.mcpEndpoint,
      visibility: "private",
      enabled: true,
      credential_sources: [{
        kind: "secret_ref",
        target: "header",
        name: "X-GRID-TAP-Marker",
        secret_ref: memberPrivate.credentialId,
      }],
    }));
    expect([400, 403, 404], JSON.stringify(crossOwnerMcp.body)).toContain(crossOwnerMcp.status);
    await evidenceScreenshot(page, testInfo, "cross-owner-credential-binding-denied");

    await installPersona(page, env, "member");
    const team = await createFixture(page, {
      owner: "member",
      nameToken: `${base}-team`,
      visibility: "team",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
    });
    fixtures.push(team);

    await installPersona(page, env, "admin");
    const teamMcpObject = `mcp_server:${team.mcpId}`;
    const teamAgentObject = `agent:${team.agentId}`;
    const teamSecretObject = `secret_ref:${team.credentialId}`;
    for (const relation of ["reader", "user", "invoker"] as const) {
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation, object: teamMcpObject });
    }
    await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object: teamAgentObject });
    await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "metadata_reader", object: teamSecretObject });
    await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object: teamSecretObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#admin`, relation: "private_marker", object: teamMcpObject }, false);
    for (const subject of [env.admin.subject, env.member.subject]) {
      await expectDecision(page, { subject, type: "mcp_server", id: team.mcpId, action: "invoke" }, "ALLOW");
      await expectDecision(page, { subject, type: "agent", id: team.agentId, action: "use" }, "ALLOW");
      await expectDecision(page, { subject, type: "secret_ref", id: team.credentialId, action: "use" }, "ALLOW");
    }
    for (const persona of ["admin", "member"] as const) {
      await installPersona(page, env, persona);
      expect((await api(page, `/api/mcp-servers?id=${encodeURIComponent(team.mcpId)}`)).status).toBe(200);
      expect((await api(page, `/api/dynamic-agents/agents/${encodeURIComponent(team.agentId)}`)).status).toBe(200);
      expect((await api(page, `/api/credentials/secrets/${encodeURIComponent(team.credentialId)}`)).status).toBe(200);
      expect((await api(page, "/api/mcp-servers/agent-context", json("POST", { serverIds: [team.mcpId] }))).status).toBe(200);
    }
    await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
    await evidenceScreenshot(page, testInfo, "team-access-both-identities");

    await installPersona(page, env, "member");
    const forbiddenGlobalCredential = await api(page, "/api/credentials/secrets", json("POST", {
      name: `${base}-member-global-credential`,
      description: "GRID TAP forbidden organization credential attempt",
      type: "custom",
      value: `${base}-harmless-marker`,
      ownerType: "organization",
      ownerId: env.orgKey,
    }));
    expect([403, 404], JSON.stringify(forbiddenGlobalCredential.body)).toContain(forbiddenGlobalCredential.status);
    const forbiddenGlobalMcp = await api(page, "/api/mcp-servers", json("POST", {
      id: `${base}-member-global-mcp`,
      name: `${base}-member-global-mcp`,
      transport: "http",
      endpoint: env.mcpEndpoint,
      visibility: "global",
      enabled: true,
    }));
    expect(forbiddenGlobalMcp.status, JSON.stringify(forbiddenGlobalMcp.body)).toBe(403);
    await evidenceScreenshot(page, testInfo, "non-admin-global-create-denied");

    await installPersona(page, env, "admin");
    const global = await createFixture(page, {
      owner: "admin",
      nameToken: `${base}-global`,
      visibility: "global",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
      credentialOwner: { type: "organization", id: env.orgKey },
    });
    fixtures.push(global);
    const globalMcpObject = `mcp_server:${global.mcpId}`;
    const globalAgentObject = `agent:${global.agentId}`;
    const globalSecretObject = `secret_ref:${global.credentialId}`;
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "reader", object: globalMcpObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "user", object: globalMcpObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "invoker", object: globalMcpObject }, false);
    await expectTuple(page, { user: `organization:${env.orgKey}#admin`, relation: "private_marker", object: globalMcpObject }, false);
    await expectTuple(page, { user: "user:*", relation: "user", object: globalAgentObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "metadata_reader", object: globalSecretObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "user", object: globalSecretObject });
    await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: global.mcpId, action: "read" }, "ALLOW");
    await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: global.mcpId, action: "invoke" }, "DENY");
    await expectDecision(page, { subject: env.member.subject, type: "agent", id: global.agentId, action: "use" }, "ALLOW");
    await expectDecision(page, { subject: env.member.subject, type: "secret_ref", id: global.credentialId, action: "use" }, "ALLOW");
    for (const persona of ["admin", "member"] as const) {
      await installPersona(page, env, persona);
      expect((await api(page, `/api/mcp-servers?id=${encodeURIComponent(global.mcpId)}`)).status).toBe(200);
      expect((await api(page, `/api/dynamic-agents/agents/${encodeURIComponent(global.agentId)}`)).status).toBe(200);
      expect((await api(page, `/api/credentials/secrets/${encodeURIComponent(global.credentialId)}`)).status).toBe(200);
    }
    const globalLocalContext = await api(page, "/api/mcp-servers/agent-context", json("POST", { serverIds: [global.mcpId] }));
    expect(globalLocalContext.status, JSON.stringify(globalLocalContext.body)).toBe(403);
    await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
    await evidenceScreenshot(page, testInfo, "global-access-both-identities");

    await attachEvidence(testInfo, "resource-manifest", {
      prefix: env.prefix,
      team: env.teamSlug,
      fixtures,
      gatewayContract: {
        privateMarkerTuples: "absent",
        privateOwnerDirectInvoke: "allow",
        privateOtherDirectInvoke: "deny",
        teamMemberDirectInvoke: "allow",
        globalMemberDirectInvoke: "deny",
        globalMemberAgentMediatedDiscovery: "requires real-browser probe",
      },
    });
  });
});
