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

type Persona = "admin" | "member";
type Visibility = "private" | "team" | "global";

type McpFixture = {
  id: string;
  name: string;
  owner: Persona;
  visibility: Visibility;
};

async function createMcp(
  page: Parameters<typeof api>[0],
  input: {
    name: string;
    visibility: Visibility;
    teamSlug: string;
    endpoint: string;
  },
): Promise<McpFixture> {
  const result = await api(page, "/api/mcp-servers", json("POST", {
    id: input.name,
    name: input.name,
    description: "GRID TAP harmless MCP probe fixture",
    transport: "http",
    endpoint: input.endpoint,
    visibility: input.visibility,
    ...(input.visibility === "team" ? { owner_team_slug: input.teamSlug } : {}),
    enabled: true,
    credential_sources: [],
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  const data = dataRecord(result);
  expect(String(data.agentgateway_endpoint ?? data.endpoint ?? "")).toContain("agentgateway");
  return {
    id: idFrom(result, ["_id", "id"]),
    name: input.name,
    owner: "admin",
    visibility: input.visibility,
  };
}

async function probeTools(page: Parameters<typeof api>[0], fixture: McpFixture) {
  const result = await api(page, `/api/mcp-servers/probe?id=${encodeURIComponent(fixture.id)}`, { method: "POST" });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const data = dataRecord(result);
  expect(data.success).toBe(true);
  expect(data.source).toBe("agentgateway");
  expect(Array.isArray(data.tools) ? data.tools.length : 0).toBeGreaterThan(0);
  return data;
}

async function testConnection(page: Parameters<typeof api>[0], fixture: McpFixture) {
  const result = await api(page, "/api/mcp-servers/credential-probe", json("POST", {
    server_id: fixture.id,
    credential_sources: [],
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(dataRecord(result).ok).toBe(true);
  return dataRecord(result);
}

async function expectHiddenFromList(page: Parameters<typeof api>[0], name: string) {
  await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.getByText(name, { exact: true }).count()).toBe(0);
}

async function expectVisibleInList(page: Parameters<typeof api>[0], name: string) {
  await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.getByText(name, { exact: true }).count()).toBeGreaterThan(0);
}

test.describe("PR 468 saved AgentGateway MCP probes", () => {
  test("private, shared-team, and global probes preserve authorization", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    const base = `${env.prefix}-probe-${testInfo.retry}`.slice(0, 84);
    const fixtures: McpFixture[] = [];
    const probeEvidence: Record<string, unknown> = {};

    await installPersona(page, env, "admin");
    const adminPrivate = await createMcp(page, {
      name: `${base}-admin-private`,
      visibility: "private",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
    });
    adminPrivate.owner = "admin";
    fixtures.push(adminPrivate);
    const adminPrivateObject = `mcp_server:${adminPrivate.id}`;
    await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "owner", object: adminPrivateObject });
    await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "creator", object: adminPrivateObject });
    await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation: "user", object: adminPrivateObject }, false);
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "user", object: adminPrivateObject }, false);
    await expectTuple(page, { user: `organization:${env.orgKey}#admin`, relation: "private_marker", object: adminPrivateObject }, false);
    await expectDecision(page, { subject: env.admin.subject, type: "mcp_server", id: adminPrivate.id, action: "invoke" }, "DENY");
    await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: adminPrivate.id, action: "read" }, "DENY");
    probeEvidence.adminPrivateConnection = await testConnection(page, adminPrivate);
    probeEvidence.adminPrivateTools = await probeTools(page, adminPrivate);
    await expectVisibleInList(page, adminPrivate.name);
    await evidenceScreenshot(page, testInfo, "admin-private-owner-probe");

    await installPersona(page, env, "member");
    const deniedAdminPrivate = await api(page, `/api/mcp-servers/probe?id=${encodeURIComponent(adminPrivate.id)}`, { method: "POST" });
    expect([403, 404], JSON.stringify(deniedAdminPrivate.body)).toContain(deniedAdminPrivate.status);
    await expectHiddenFromList(page, adminPrivate.name);
    await evidenceScreenshot(page, testInfo, "admin-private-hidden-from-member");

    const memberPrivate = await createMcp(page, {
      name: `${base}-member-private`,
      visibility: "private",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
    });
    memberPrivate.owner = "member";
    fixtures.push(memberPrivate);
    const memberPrivateObject = `mcp_server:${memberPrivate.id}`;
    probeEvidence.memberPrivateConnection = await testConnection(page, memberPrivate);
    probeEvidence.memberPrivateTools = await probeTools(page, memberPrivate);
    await expectVisibleInList(page, memberPrivate.name);
    await evidenceScreenshot(page, testInfo, "member-private-owner-probe");

    await installPersona(page, env, "admin");
    await expectTuple(page, { user: `user:${env.member.subject}`, relation: "owner", object: memberPrivateObject });
    await expectTuple(page, { user: `user:${env.member.subject}`, relation: "creator", object: memberPrivateObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#admin`, relation: "private_marker", object: memberPrivateObject }, false);
    await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: memberPrivate.id, action: "invoke" }, "DENY");
    await expectDecision(page, { subject: env.admin.subject, type: "mcp_server", id: memberPrivate.id, action: "read" }, "DENY");
    const deniedMemberPrivate = await api(page, `/api/mcp-servers/probe?id=${encodeURIComponent(memberPrivate.id)}`, { method: "POST" });
    expect([403, 404], JSON.stringify(deniedMemberPrivate.body)).toContain(deniedMemberPrivate.status);
    await expectHiddenFromList(page, memberPrivate.name);
    await evidenceScreenshot(page, testInfo, "member-private-hidden-from-admin");

    await installPersona(page, env, "member");
    const team = await createMcp(page, {
      name: `${base}-team`,
      visibility: "team",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
    });
    team.owner = "member";
    fixtures.push(team);
    const teamObject = `mcp_server:${team.id}`;
    const deniedTeamMemberConnection = await api(page, "/api/mcp-servers/credential-probe", json("POST", {
      server_id: team.id,
      credential_sources: [],
    }));
    expect([403, 404], JSON.stringify(deniedTeamMemberConnection.body)).toContain(deniedTeamMemberConnection.status);
    probeEvidence.teamMemberConnection = deniedTeamMemberConnection;
    probeEvidence.teamMemberTools = await probeTools(page, team);
    await expectVisibleInList(page, team.name);
    await evidenceScreenshot(page, testInfo, "team-member-owner-probe");

    await installPersona(page, env, "admin");
    for (const relation of ["reader", "user", "invoker"] as const) {
      await expectTuple(page, { user: `team:${env.teamSlug}#member`, relation, object: teamObject });
    }
    await expectTuple(page, { user: `organization:${env.orgKey}#admin`, relation: "private_marker", object: teamObject }, false);
    for (const subject of [env.admin.subject, env.member.subject]) {
      await expectDecision(page, { subject, type: "mcp_server", id: team.id, action: "read" }, "ALLOW");
      await expectDecision(page, { subject, type: "mcp_server", id: team.id, action: "invoke" }, "ALLOW");
    }
    probeEvidence.teamAdminConnection = await testConnection(page, team);
    probeEvidence.teamAdminTools = await probeTools(page, team);
    await expectVisibleInList(page, team.name);
    await evidenceScreenshot(page, testInfo, "team-visible-and-probeable-by-admin");

    const global = await createMcp(page, {
      name: `${base}-global`,
      visibility: "global",
      teamSlug: env.teamSlug,
      endpoint: env.mcpEndpoint,
    });
    global.owner = "admin";
    fixtures.push(global);
    const globalObject = `mcp_server:${global.id}`;
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "reader", object: globalObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "user", object: globalObject });
    await expectTuple(page, { user: `organization:${env.orgKey}#member`, relation: "invoker", object: globalObject }, false);
    await expectTuple(page, { user: `organization:${env.orgKey}#admin`, relation: "private_marker", object: globalObject }, false);
    await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: global.id, action: "read" }, "ALLOW");
    await expectDecision(page, { subject: env.member.subject, type: "mcp_server", id: global.id, action: "invoke" }, "DENY");
    probeEvidence.globalAdminConnection = await testConnection(page, global);
    probeEvidence.globalAdminTools = await probeTools(page, global);
    await expectVisibleInList(page, global.name);
    await evidenceScreenshot(page, testInfo, "global-admin-owner-probe");

    await installPersona(page, env, "member");
    probeEvidence.globalMemberTools = await probeTools(page, global);
    const deniedGlobalConnection = await api(page, "/api/mcp-servers/credential-probe", json("POST", {
      server_id: global.id,
      credential_sources: [],
    }));
    expect([403, 404], JSON.stringify(deniedGlobalConnection.body)).toContain(deniedGlobalConnection.status);
    await expectVisibleInList(page, global.name);
    await evidenceScreenshot(page, testInfo, "global-member-discovery-probe");

    await attachEvidence(testInfo, "resource-manifest", {
      prefix: env.prefix,
      endpoint: env.mcpEndpoint,
      fixtures,
      probeEvidence,
      expectedContract: {
        privateMarkerTuples: "absent",
        privateOtherAccess: "denied",
        teamBothDiscoverAndInvoke: "allowed",
        globalMemberDiscover: "allowed",
        globalMemberDirectInvoke: "denied",
      },
    });
  });
});
