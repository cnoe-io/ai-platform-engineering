// assisted-by Codex Codex-sonnet-4-6
/**
 * Real local RBAC regression matrix.
 *
 * This spec intentionally creates a broad local fixture through product/admin
 * APIs only. It must not write MongoDB rows directly or write OpenFGA tuples
 * directly; the point is to prove that the public lifecycle paths create
 * source-owned relationships that Self Check can explain and clean up.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { rbacEnvOrSkip, type RbacEnv } from "./_env";
import { installTestSession } from "./_helpers";

type ApiResult<T = unknown> = {
  status: number;
  body: T;
};

type DecisionExpectation = "ALLOW" | "DENY";
type ActorType = "user" | "service_account";
type BulkAgentKind = "ops-team" | "data-shared" | "global" | "service-account-scoped";

type SelfCheckAssertion = {
  id: string;
  title: string;
  actor: { type: ActorType; id: string; label: string };
  resource: { type: string; id: string; label: string };
  action: string;
  expect: DecisionExpectation;
};

type CreatedUser = { email: string; id: string; sub: string; label: string };
type CreatedTeam = { id: string; slug: string; label: string };
type CreatedAgent = { id: string; label: string; kind: BulkAgentKind };
type CreatedChannel = { workspaceId: string; channelId: string; objectId: string };
type CreatedWebexSpace = { workspaceId: string; spaceId: string; objectId: string };

type RichFixture = {
  runId: string;
  teams: CreatedTeam[];
  users: CreatedUser[];
  agents: CreatedAgent[];
  mcpServers: string[];
  llmModels: string[];
  credentials: string[];
  serviceAccounts: string[];
  slackChannels: CreatedChannel[];
  webexSpaces: CreatedWebexSpace[];
  assertions: SelfCheckAssertion[];
};

type RbacSelfCheckFinding = {
  id?: string;
  severity?: string;
  title?: string;
  detail?: string;
  fix?: string;
  tuple?: { user: string; relation: string; object: string };
};

let env: RbacEnv;

const CORE_AGENT_COUNT = 4;
const SOURCE = "rbac-rich-local-regression";
const DEFAULT_AGENT_COUNT = 12;

test.beforeAll(() => {
  env = rbacEnvOrSkip({ requireUserSub: true });
});

function runSuffix(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function configuredAgentCount(): number {
  const raw = process.env.RBAC_RICH_AGENT_COUNT?.trim();
  if (!raw) return DEFAULT_AGENT_COUNT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < CORE_AGENT_COUNT) return DEFAULT_AGENT_COUNT;
  return Math.floor(parsed);
}

function shouldKeepFixture(): boolean {
  const raw = process.env.RBAC_RICH_KEEP_FIXTURE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function cleanupRunId(): string | null {
  return process.env.RBAC_RICH_CLEANUP_RUN_ID?.trim() || null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function compactId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) || runSuffix();
}

function bodyRecord(result: ApiResult): Record<string, unknown> {
  return typeof result.body === "object" && result.body !== null
    ? (result.body as Record<string, unknown>)
    : {};
}

function dataRecord(result: ApiResult): Record<string, unknown> {
  const body = bodyRecord(result);
  return typeof body.data === "object" && body.data !== null
    ? (body.data as Record<string, unknown>)
    : body;
}

function itemsFromResult(result: ApiResult): unknown[] {
  const body = bodyRecord(result);
  const data = dataRecord(result);
  const keys = [
    "items",
    "users",
    "teams",
    "channels",
    "spaces",
    "members",
    "agents",
    "servers",
    "models",
    "service_accounts",
  ];
  for (const key of keys) {
    const value = data[key] ?? body[key];
    if (Array.isArray(value)) return value;
  }
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(result.body)) return result.body;
  return [];
}

function idFrom(result: ApiResult, keys: string[]): string {
  const data = dataRecord(result);
  const body = bodyRecord(result);
  for (const key of keys) {
    const value = data[key] ?? body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && "toString" in value) {
      const rendered = String(value);
      if (rendered && rendered !== "[object Object]") return rendered;
    }
  }
  throw new Error(`Could not extract id from response: ${JSON.stringify(result.body)}`);
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function apiError(result: ApiResult): string {
  return `${result.status} ${JSON.stringify(result.body)}`;
}

function expectStatus(result: ApiResult, statuses: number[]): void {
  expect(statuses, apiError(result)).toContain(result.status);
}

async function fetchJson<T = unknown>(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ path: requestPath, init: requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
      return { status: response.status, body };
    },
    { path, init },
  ) as Promise<ApiResult<T>>;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function postJson<T = unknown>(page: Page, path: string, body: unknown): Promise<ApiResult<T>> {
  return fetchJson<T>(page, path, jsonInit("POST", body));
}

async function putJson<T = unknown>(page: Page, path: string, body: unknown): Promise<ApiResult<T>> {
  return fetchJson<T>(page, path, jsonInit("PUT", body));
}

async function patchJson<T = unknown>(page: Page, path: string, body: unknown): Promise<ApiResult<T>> {
  return fetchJson<T>(page, path, jsonInit("PATCH", body));
}

async function deleteJson<T = unknown>(page: Page, path: string): Promise<ApiResult<T>> {
  return fetchJson<T>(page, path, { method: "DELETE" });
}

async function installSession(
  page: Page,
  input: { email: string; subject: string; role: "admin" | "user" },
): Promise<void> {
  await page.context().clearCookies();
  await installTestSession(page, env, input);
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

function assertion(
  id: string,
  title: string,
  actor: { type?: ActorType; id: string; label: string },
  resource: { type: string; id: string; label: string },
  action: string,
  expectDecision: DecisionExpectation,
): SelfCheckAssertion {
  return {
    id,
    title,
    actor: { type: actor.type ?? "user", id: actor.id, label: actor.label },
    resource,
    action,
    expect: expectDecision,
  };
}

async function provisionUser(page: Page, runId: string, key: string, label: string): Promise<CreatedUser> {
  const email = `${runId}-${key}@example.test`;
  const result = await postJson(page, "/api/admin/users/provision-shell", {
    email,
    source: SOURCE,
    attributes: {
      rbac_e2e_run_id: [runId],
      rbac_e2e_label: [label],
    },
  });
  expectStatus(result, [200]);
  const sub = idFrom(result, ["sub"]);
  return { email, id: sub, sub, label };
}

async function createTeam(page: Page, runId: string, key: string, label: string): Promise<CreatedTeam> {
  const slug = `${runId}-${key}`.slice(0, 63);
  const result = await postJson(page, "/api/admin/teams", {
    name: `${label} ${runId}`,
    slug,
    description: `${SOURCE} ${runId}`,
    members: [],
  });
  expectStatus(result, [201]);
  return { id: idFrom(result, ["team_id", "id", "_id"]), slug, label };
}

async function addTeamMember(
  page: Page,
  team: CreatedTeam,
  user: CreatedUser,
  role: "member" | "admin",
): Promise<void> {
  const result = await postJson(page, `/api/admin/teams/${encodeURIComponent(team.id)}/members`, {
    user_id: user.email,
    role,
  });
  expectStatus(result, [201]);
}

async function createMcpServer(page: Page, runId: string, key: string, team: CreatedTeam): Promise<string> {
  const id = `mcp-${runId}-${key}`.slice(0, 96);
  const result = await postJson(page, "/api/mcp-servers", {
    id,
    name: `RBAC rich ${key} MCP ${runId}`,
    description: `${SOURCE} ${runId}`,
    transport: "sse",
    endpoint: `https://example.test/${runId}/${key}/sse`,
    owner_team_slug: team.slug,
    enabled: true,
  });
  expectStatus(result, [201]);
  return idFrom(result, ["_id", "id"]);
}

async function createAgent(
  page: Page,
  input: {
    runId: string;
    key: string;
    label: string;
    kind: BulkAgentKind;
    ownerTeam: CreatedTeam;
    sharedTeams?: CreatedTeam[];
    visibility?: "team" | "global";
    allowedTools?: Record<string, string[]>;
  },
): Promise<CreatedAgent> {
  const result = await postJson(page, "/api/dynamic-agents", {
    name: `${input.label} ${input.runId}`,
    description: `${SOURCE} ${input.runId} ${input.kind}`,
    system_prompt: `Local RBAC regression fixture ${input.runId}.`,
    model: { id: "gpt-4o-mini", provider: "openai" },
    visibility: input.visibility ?? "team",
    owner_team_slug: input.visibility === "global" ? undefined : input.ownerTeam.slug,
    shared_with_teams: input.sharedTeams?.map((team) => team.slug) ?? [],
    allowed_tools: input.allowedTools ?? {},
    enabled: true,
  });
  expectStatus(result, [201]);
  return {
    id: idFrom(result, ["_id", "id"]),
    label: input.label,
    kind: input.kind,
  };
}

async function createLlmModel(page: Page, runId: string): Promise<string> {
  const modelId = `${runId}-llm`;
  const result = await postJson(page, "/api/llm-models", {
    model_id: modelId,
    name: `RBAC rich LLM ${runId}`,
    provider: "local-regression",
    description: `${SOURCE} ${runId}`,
  });
  expectStatus(result, [201]);
  return modelId;
}

async function createCredential(page: Page, runId: string, key: string): Promise<string> {
  const result = await postJson(page, "/api/credentials/secrets", {
    name: `RBAC rich ${key} credential ${runId}`,
    type: "api_key",
    description: `${SOURCE} ${runId}`,
    value: `secret-${runId}-${key}`,
  });
  expectStatus(result, [201]);
  return idFrom(result, ["id", "_id", "secret_id"]);
}

async function shareCredentialWithTeam(page: Page, secretId: string, team: CreatedTeam): Promise<void> {
  const result = await patchJson(page, `/api/credentials/secrets/${encodeURIComponent(secretId)}`, {
    action: "share",
    teamId: team.slug,
  });
  expectStatus(result, [200]);
}

async function createServiceAccount(
  page: Page,
  runId: string,
  ownerTeam: CreatedTeam,
  agentScopes: string[],
): Promise<string> {
  const result = await postJson(page, "/api/admin/service-accounts", {
    name: `RBAC rich ${runId} SA`.slice(0, 64),
    description: `${SOURCE} ${runId}`,
    owning_team_id: ownerTeam.slug,
    scopes: agentScopes.map((agentId) => ({ type: "agent", ref: agentId })),
  });
  expectStatus(result, [201]);
  return idFrom(result, ["id", "sa_sub"]);
}

async function maybeUnlinkedServiceAccount(page: Page): Promise<string | null> {
  const result = await fetchJson(page, "/api/admin/service-accounts/unlinked");
  if (result.status !== 200) return null;
  const data = dataRecord(result);
  const value = data.id ?? data.sa_sub ?? data.subject_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function createSlackChannel(
  page: Page,
  runId: string,
  team: CreatedTeam,
  agentId: string,
): Promise<CreatedChannel> {
  const workspaceId = "CAIPE";
  const channelId = `C${compactId(runId).toUpperCase()}`;
  const teamResult = await putJson(page, `/api/admin/slack/channels/${workspaceId}/${channelId}/team`, {
    team_slug: team.slug,
    channel_name: `rbac-rich-${runId}`,
  });
  expectStatus(teamResult, [200]);

  const grantsResult = await putJson(page, `/api/admin/slack/channels/${workspaceId}/${channelId}/resources`, {
    grants: [
      {
        resource: { type: "agent", id: agentId },
        actions: ["use"],
      },
    ],
  });
  expectStatus(grantsResult, [200]);
  const resolvedWorkspace = String(dataRecord(teamResult).workspace_id ?? workspaceId);
  return {
    workspaceId: resolvedWorkspace,
    channelId,
    objectId: `${resolvedWorkspace}--${channelId}`,
  };
}

async function createWebexSpace(
  page: Page,
  runId: string,
  team: CreatedTeam,
  agentId: string,
): Promise<CreatedWebexSpace> {
  const workspaceId = "Cisco";
  const spaceId = `space-${slugify(runId)}`.slice(0, 80);
  const result = await postJson(page, "/api/admin/webex/spaces/onboard", {
    workspace_id: workspaceId,
    space_id: spaceId,
    space_name: `rbac-rich-${runId}`,
    team_slug: team.slug,
    agent_id: agentId,
    listen: "mention",
    reload_runtime: false,
  });
  expectStatus(result, [200]);
  const data = dataRecord(result);
  const resolvedWorkspace = String(data.workspace_id ?? workspaceId);
  return {
    workspaceId: resolvedWorkspace,
    spaceId,
    objectId: `${resolvedWorkspace}--${spaceId}`,
  };
}

async function createFixture(page: Page, runId: string): Promise<RichFixture> {
  const users = [
    await provisionUser(page, runId, "ops-member", "Ops member"),
    await provisionUser(page, runId, "ops-admin", "Ops team admin"),
    await provisionUser(page, runId, "data-member", "Data member"),
    await provisionUser(page, runId, "outsider", "Outsider"),
  ];
  const [opsMember, opsAdmin, dataMember, outsider] = users;

  const opsTeam = await createTeam(page, runId, "ops", "RBAC rich ops team");
  const dataTeam = await createTeam(page, runId, "data", "RBAC rich data team");
  await addTeamMember(page, opsTeam, opsMember, "member");
  await addTeamMember(page, opsTeam, opsAdmin, "admin");
  await addTeamMember(page, dataTeam, dataMember, "member");

  const mcpOps = await createMcpServer(page, runId, "ops", opsTeam);
  const mcpData = await createMcpServer(page, runId, "data", dataTeam);
  const llmModel = await createLlmModel(page, runId);

  const agents: CreatedAgent[] = [];
  const serviceScopedAgents: string[] = [];
  const privateAgent = await createAgent(page, {
    runId,
    key: "private",
    label: "RBAC rich private agent",
    kind: "ops-team",
    ownerTeam: opsTeam,
    allowedTools: { [mcpOps]: ["*"] },
  });
  agents.push(privateAgent);
  const sharedAgent = await createAgent(page, {
    runId,
    key: "shared",
    label: "RBAC rich shared agent",
    kind: "data-shared",
    ownerTeam: opsTeam,
    sharedTeams: [dataTeam],
    allowedTools: { [mcpData]: ["*"] },
  });
  agents.push(sharedAgent);
  const globalAgent = await createAgent(page, {
    runId,
    key: "global",
    label: "RBAC rich global agent",
    kind: "global",
    ownerTeam: opsTeam,
    visibility: "global",
  });
  agents.push(globalAgent);
  const serviceAgent = await createAgent(page, {
    runId,
    key: "service",
    label: "RBAC rich service scoped agent",
    kind: "service-account-scoped",
    ownerTeam: opsTeam,
    allowedTools: { [mcpOps]: ["*"] },
  });
  agents.push(serviceAgent);
  serviceScopedAgents.push(serviceAgent.id);

  const bulkKinds: BulkAgentKind[] = ["ops-team", "data-shared", "global", "service-account-scoped"];
  const targetAgentCount = configuredAgentCount();
  for (let index = agents.length; index < targetAgentCount; index += 1) {
    const kind = bulkKinds[index % bulkKinds.length];
    const label = `RBAC rich generated agent ${String(index + 1).padStart(3, "0")}`;
    const agent = await createAgent(page, {
      runId,
      key: String(index + 1).padStart(3, "0"),
      label,
      kind,
      ownerTeam: opsTeam,
      sharedTeams: kind === "data-shared" ? [dataTeam] : [],
      visibility: kind === "global" ? "global" : "team",
      allowedTools: kind === "data-shared" ? { [mcpData]: ["*"] } : { [mcpOps]: ["*"] },
    });
    agents.push(agent);
    if (kind === "service-account-scoped") serviceScopedAgents.push(agent.id);
  }

  const privateCredential = await createCredential(page, runId, "private");
  const sharedCredential = await createCredential(page, runId, "shared");
  await shareCredentialWithTeam(page, sharedCredential, opsTeam);

  const serviceAccount = await createServiceAccount(page, runId, opsTeam, serviceScopedAgents);
  const unlinkedServiceAccount = await maybeUnlinkedServiceAccount(page);
  const slackChannel = await createSlackChannel(page, runId, opsTeam, privateAgent.id);
  const webexSpace = await createWebexSpace(page, runId, opsTeam, sharedAgent.id);

  const admin = { id: env.user.sub!, label: "Current org admin" };
  const linkedSa = { type: "service_account" as const, id: serviceAccount, label: "Linked service account" };
  const unlinkedSa = unlinkedServiceAccount
    ? { type: "service_account" as const, id: unlinkedServiceAccount, label: "Unlinked service account" }
    : null;
  const r = (type: string, id: string, label: string) => ({ type, id, label });

  const assertions: SelfCheckAssertion[] = [
    assertion("ops-member-can-use-private-agent", "Ops member can use team agent", opsMember, r("agent", privateAgent.id, privateAgent.label), "use", "ALLOW"),
    assertion("data-member-cannot-use-private-agent", "Data member cannot use ops-only agent", dataMember, r("agent", privateAgent.id, privateAgent.label), "use", "DENY"),
    assertion("data-member-can-use-shared-agent", "Data member can use shared agent", dataMember, r("agent", sharedAgent.id, sharedAgent.label), "use", "ALLOW"),
    assertion("outsider-can-use-global-agent", "Outsider can use global agent", outsider, r("agent", globalAgent.id, globalAgent.label), "use", "ALLOW"),
    assertion("linked-sa-can-use-scoped-agent", "Linked service account can use scoped agent", linkedSa, r("agent", serviceAgent.id, serviceAgent.label), "use", "ALLOW"),
    ...(unlinkedSa
      ? [
          assertion("unlinked-sa-cannot-use-scoped-agent", "Unlinked service account cannot use scoped agent", unlinkedSa, r("agent", serviceAgent.id, serviceAgent.label), "use", "DENY"),
        ]
      : []),

    assertion("ops-member-can-read-mcp", "Ops member can read MCP server", opsMember, r("mcp_server", mcpOps, "Ops MCP"), "read", "ALLOW"),
    assertion("ops-member-can-use-mcp", "Ops member can use MCP server", opsMember, r("mcp_server", mcpOps, "Ops MCP"), "use", "ALLOW"),
    assertion("data-member-cannot-use-ops-mcp", "Data member cannot use ops MCP server", dataMember, r("mcp_server", mcpOps, "Ops MCP"), "use", "DENY"),
    assertion("data-member-can-use-data-mcp", "Data member can use data MCP server", dataMember, r("mcp_server", mcpData, "Data MCP"), "use", "ALLOW"),

    assertion("admin-can-read-private-credential", "Credential owner can read private credential metadata", admin, r("secret_ref", privateCredential, "Private credential"), "read-metadata", "ALLOW"),
    assertion("ops-member-cannot-use-private-credential", "Ops member cannot use private credential", opsMember, r("secret_ref", privateCredential, "Private credential"), "use", "DENY"),
    assertion("ops-member-can-use-shared-credential", "Ops member can use shared credential", opsMember, r("secret_ref", sharedCredential, "Shared credential"), "use", "ALLOW"),
    assertion("outsider-cannot-use-shared-credential", "Outsider cannot use shared credential", outsider, r("secret_ref", sharedCredential, "Shared credential"), "use", "DENY"),

    assertion("admin-can-manage-llm", "Org admin can manage created LLM model", admin, r("llm_model", llmModel, "Regression LLM"), "manage", "ALLOW"),
    assertion("outsider-cannot-read-llm", "Outsider cannot read created LLM model", outsider, r("llm_model", llmModel, "Regression LLM"), "read", "DENY"),

    assertion("ops-member-can-use-slack-channel", "Ops member can use Slack channel", opsMember, r("slack_channel", slackChannel.objectId, "Regression Slack channel"), "use", "ALLOW"),
    assertion("outsider-cannot-use-slack-channel", "Outsider cannot use Slack channel", outsider, r("slack_channel", slackChannel.objectId, "Regression Slack channel"), "use", "DENY"),
    assertion("ops-member-can-use-webex-space", "Ops member can use Webex space", opsMember, r("webex_space", webexSpace.objectId, "Regression Webex space"), "use", "ALLOW"),
    assertion("outsider-cannot-use-webex-space", "Outsider cannot use Webex space", outsider, r("webex_space", webexSpace.objectId, "Regression Webex space"), "use", "DENY"),
    assertion("linked-sa-can-list-gateway", "Linked service account can list MCP gateway", linkedSa, r("mcp_gateway", "list", "MCP gateway list"), "call", "ALLOW"),
  ];

  for (const agent of agents) {
    const resource = r("agent", agent.id, agent.label);
    if (agent.kind === "ops-team") {
      assertions.push(
        assertion(`${agent.id}:ops-member-allow`, `Ops member can use ${agent.label}`, opsMember, resource, "use", "ALLOW"),
        assertion(`${agent.id}:outsider-deny`, `Outsider cannot use ${agent.label}`, outsider, resource, "use", "DENY"),
      );
    } else if (agent.kind === "data-shared") {
      assertions.push(
        assertion(`${agent.id}:data-member-allow`, `Data member can use ${agent.label}`, dataMember, resource, "use", "ALLOW"),
        assertion(`${agent.id}:outsider-deny`, `Outsider cannot use ${agent.label}`, outsider, resource, "use", "DENY"),
      );
    } else if (agent.kind === "global") {
      assertions.push(
        assertion(`${agent.id}:outsider-allow`, `Outsider can use global ${agent.label}`, outsider, resource, "use", "ALLOW"),
      );
    } else {
      assertions.push(
        assertion(`${agent.id}:linked-sa-allow`, `Linked service account can use ${agent.label}`, linkedSa, resource, "use", "ALLOW"),
        ...(unlinkedSa
          ? [assertion(`${agent.id}:unlinked-sa-deny`, `Unlinked service account cannot use ${agent.label}`, unlinkedSa, resource, "use", "DENY")]
          : []),
      );
    }
  }

  return {
    runId,
    teams: [opsTeam, dataTeam],
    users,
    agents,
    mcpServers: [mcpOps, mcpData],
    llmModels: [llmModel],
    credentials: [privateCredential, sharedCredential],
    serviceAccounts: [serviceAccount],
    slackChannels: [slackChannel],
    webexSpaces: [webexSpace],
    assertions,
  };
}

async function expectSelfCheckAssertions(page: Page, assertions: SelfCheckAssertion[]): Promise<void> {
  const result = await postJson(page, "/api/admin/rebac/self-check/tests", {
    suites: ["custom_assertions"],
    assertions,
  });
  expectStatus(result, [200]);
  const data = dataRecord(result);
  const summary = nestedRecord(data.summary);
  expect(summary.failed, JSON.stringify(result.body)).toBe(0);
  expect(summary.blocked, JSON.stringify(result.body)).toBe(0);
  const suites = Array.isArray(data.suites) ? (data.suites as Array<Record<string, unknown>>) : [];
  const customSuite = suites.find((suite) => suite.id === "custom_assertions");
  expect(customSuite?.status, JSON.stringify(result.body)).toBe("pass");
}

function findingMatchesRun(finding: unknown, runId: string): boolean {
  return JSON.stringify(finding).includes(runId);
}

async function runSelfCheck(page: Page): Promise<Record<string, unknown>> {
  const result = await fetchJson(page, "/api/admin/rebac/self-check");
  expectStatus(result, [200]);
  return dataRecord(result);
}

async function expectNoRunIdSelfCheckFindings(page: Page, runId: string, label: string): Promise<void> {
  const report = await runSelfCheck(page);
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const runFindings = findings.filter((finding) => findingMatchesRun(finding, runId)) as RbacSelfCheckFinding[];
  expect(
    runFindings,
    `${label}: Self Check still reports findings for ${runId}: ${JSON.stringify(runFindings.slice(0, 10), null, 2)}`,
  ).toHaveLength(0);
}

async function bestEffortDelete(page: Page, path: string): Promise<void> {
  const result = await deleteJson(page, path);
  if (![200, 204, 404].includes(result.status)) {
    throw new Error(`DELETE ${path} failed: ${apiError(result)}`);
  }
}

async function removeTeamMemberIfPresent(page: Page, team: CreatedTeam, user: CreatedUser): Promise<void> {
  const path = `/api/admin/teams/${encodeURIComponent(team.id)}/members?user_id=${encodeURIComponent(user.email)}`;
  const result = await deleteJson(page, path);
  if (![200, 204, 400, 404].includes(result.status)) {
    throw new Error(`DELETE ${path} failed: ${apiError(result)}`);
  }
}

async function cleanupFixture(page: Page, fixture: RichFixture): Promise<void> {
  await installSession(page, { email: env.user.email, subject: env.user.sub!, role: "admin" });

  for (const channel of fixture.slackChannels) {
    await bestEffortDelete(
      page,
      `/api/admin/slack/channels/${encodeURIComponent(channel.workspaceId)}/${encodeURIComponent(channel.channelId)}`,
    );
  }
  for (const space of fixture.webexSpaces) {
    await bestEffortDelete(
      page,
      `/api/admin/webex/spaces/${encodeURIComponent(space.workspaceId)}/${encodeURIComponent(space.spaceId)}`,
    );
  }
  for (const id of fixture.serviceAccounts) {
    await bestEffortDelete(page, `/api/admin/service-accounts/${encodeURIComponent(id)}`);
  }
  for (const id of fixture.credentials) {
    await bestEffortDelete(page, `/api/credentials/secrets/${encodeURIComponent(id)}`);
  }
  for (const agent of fixture.agents) {
    await bestEffortDelete(page, `/api/dynamic-agents?id=${encodeURIComponent(agent.id)}`);
  }
  for (const id of fixture.mcpServers) {
    await bestEffortDelete(page, `/api/mcp-servers?id=${encodeURIComponent(id)}`);
  }
  for (const id of fixture.llmModels) {
    await bestEffortDelete(page, `/api/llm-models?id=${encodeURIComponent(id)}`);
  }

  for (const team of fixture.teams) {
    for (const user of fixture.users) {
      await removeTeamMemberIfPresent(page, team, user);
    }
  }
  for (const team of fixture.teams) {
    await bestEffortDelete(page, `/api/admin/teams/${encodeURIComponent(team.id)}`);
  }
  for (const user of fixture.users) {
    await bestEffortDelete(page, `/api/admin/users/${encodeURIComponent(user.sub)}`);
  }
}

async function listAll(page: Page, path: string): Promise<unknown[]> {
  const result = await fetchJson(page, path);
  if (result.status !== 200) return [];
  return itemsFromResult(result);
}

function itemContainsRunId(item: unknown, runId: string): boolean {
  return JSON.stringify(item).includes(runId);
}

function rowString(row: unknown, keys: string[]): string | null {
  const record = nestedRecord(row);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function expectedFixtureAgentIds(runId: string): string[] {
  const ids = new Set<string>([
    `agent-rbac-rich-private-agent-${runId}`,
    `agent-rbac-rich-shared-agent-${runId}`,
    `agent-rbac-rich-global-agent-${runId}`,
    `agent-rbac-rich-service-scoped-agent-${runId}`,
  ]);
  for (let index = CORE_AGENT_COUNT; index < 250; index += 1) {
    ids.add(`agent-rbac-rich-generated-agent-${String(index + 1).padStart(3, "0")}-${runId}`);
  }
  return [...ids];
}

async function cleanupByRunId(page: Page, runId: string): Promise<Record<string, number>> {
  await installSession(page, { email: env.user.email, subject: env.user.sub!, role: "admin" });
  const deleted: Record<string, number> = {};

  const bump = (key: string) => {
    deleted[key] = (deleted[key] ?? 0) + 1;
  };

  for (const row of (await listAll(page, "/api/admin/slack/channels?health=0")).filter((item) => itemContainsRunId(item, runId))) {
    const workspaceId = rowString(row, ["workspace_id", "slack_workspace_id"]) ?? "CAIPE";
    const channelId = rowString(row, ["channel_id", "slack_channel_id"]);
    if (channelId) {
      await bestEffortDelete(page, `/api/admin/slack/channels/${encodeURIComponent(workspaceId)}/${encodeURIComponent(channelId)}`);
      bump("slack_channels");
    }
  }

  for (const row of (await listAll(page, "/api/admin/webex/spaces?health=0")).filter((item) => itemContainsRunId(item, runId))) {
    const workspaceId = rowString(row, ["workspace_id", "webex_workspace_id"]) ?? "Cisco";
    const spaceId = rowString(row, ["space_id", "webex_space_id"]);
    if (spaceId) {
      await bestEffortDelete(page, `/api/admin/webex/spaces/${encodeURIComponent(workspaceId)}/${encodeURIComponent(spaceId)}`);
      bump("webex_spaces");
    }
  }

  for (const row of (await listAll(page, "/api/admin/service-accounts?include_revoked=true")).filter((item) => itemContainsRunId(item, runId))) {
    const id = rowString(row, ["id", "sa_sub"]);
    if (id) {
      await bestEffortDelete(page, `/api/admin/service-accounts/${encodeURIComponent(id)}`);
      bump("service_accounts");
    }
  }

  for (const row of (await listAll(page, "/api/credentials/secrets")).filter((item) => itemContainsRunId(item, runId))) {
    const id = rowString(row, ["id", "_id", "secret_id"]);
    if (id) {
      await bestEffortDelete(page, `/api/credentials/secrets/${encodeURIComponent(id)}`);
      bump("credentials");
    }
  }

  for (const row of (await listAll(page, "/api/dynamic-agents?page=1&page_size=500&pageSize=500")).filter((item) => itemContainsRunId(item, runId))) {
    const id = rowString(row, ["_id", "id"]);
    if (id) {
      await bestEffortDelete(page, `/api/dynamic-agents?id=${encodeURIComponent(id)}`);
      bump("agents");
    }
  }
  for (const id of expectedFixtureAgentIds(runId)) {
    await bestEffortDelete(page, `/api/dynamic-agents?id=${encodeURIComponent(id)}`);
  }

  for (const row of (await listAll(page, "/api/mcp-servers?page=1&page_size=500&pageSize=500")).filter((item) => itemContainsRunId(item, runId))) {
    const id = rowString(row, ["_id", "id"]);
    if (id) {
      await bestEffortDelete(page, `/api/mcp-servers?id=${encodeURIComponent(id)}`);
      bump("mcp_servers");
    }
  }
  for (const id of [`mcp-${runId}-ops`, `mcp-${runId}-data`]) {
    await bestEffortDelete(page, `/api/mcp-servers?id=${encodeURIComponent(id)}`);
  }

  for (const row of (await listAll(page, "/api/llm-models?page=1&page_size=500&pageSize=500")).filter((item) => itemContainsRunId(item, runId))) {
    const id = rowString(row, ["_id", "id", "model_id"]);
    if (id) {
      await bestEffortDelete(page, `/api/llm-models?id=${encodeURIComponent(id)}`);
      bump("llm_models");
    }
  }

  const teamRows = (await listAll(page, `/api/admin/teams?page=1&page_size=100&search=${encodeURIComponent(runId)}`))
    .filter((item) => itemContainsRunId(item, runId));
  const userRows = (await listAll(page, `/api/admin/users?page=1&pageSize=100&search=${encodeURIComponent(runId)}`))
    .filter((item) => itemContainsRunId(item, runId));
  const users = userRows
    .map((row) => ({
      id: rowString(row, ["id", "_id"]),
      email: rowString(row, ["email", "username"]),
    }))
    .filter((row): row is { id: string; email: string } => Boolean(row.id && row.email));

  for (const teamRow of teamRows) {
    const teamId = rowString(teamRow, ["_id", "id"]);
    if (!teamId) continue;
    for (const user of users) {
      const result = await deleteJson(
        page,
        `/api/admin/teams/${encodeURIComponent(teamId)}/members?user_id=${encodeURIComponent(user.email)}`,
      );
      if (![200, 204, 400, 404].includes(result.status)) {
        throw new Error(`Team member cleanup failed: ${apiError(result)}`);
      }
    }
  }
  for (const teamRow of teamRows) {
    const teamId = rowString(teamRow, ["_id", "id"]);
    if (teamId) {
      await bestEffortDelete(page, `/api/admin/teams/${encodeURIComponent(teamId)}`);
      bump("teams");
    }
  }
  for (const user of users) {
    await bestEffortDelete(page, `/api/admin/users/${encodeURIComponent(user.id)}`);
    bump("users");
  }

  return deleted;
}

test.describe.serial("RBAC rich local regression fixture", () => {
  test("creates source-owned resources through APIs and leaves no unexplained tuples", async ({ page }, testInfo) => {
    const cleanupTarget = cleanupRunId();
    if (cleanupTarget) {
      const deleted = await cleanupByRunId(page, cleanupTarget);
      await expectNoRunIdSelfCheckFindings(page, cleanupTarget, "after cleanup-by-run-id");
      console.log(`Cleaned ${cleanupTarget}: ${JSON.stringify(deleted)}`);
      return;
    }

    const runId = `rbac-rich-api-${runSuffix()}`;
    console.log(`RBAC rich regression run id: ${runId}`);
    testInfo.annotations.push({ type: "run_id", description: runId });
    let fixture: RichFixture | null = null;
    let primaryError: unknown = null;
    const keep = shouldKeepFixture();

    try {
      await installSession(page, { email: env.user.email, subject: env.user.sub!, role: "admin" });
      fixture = await createFixture(page, runId);
      await expectSelfCheckAssertions(page, fixture.assertions);
      await expectNoRunIdSelfCheckFindings(page, runId, "fixture in place");

      if (keep) {
        console.log(
          `Retained RBAC rich fixture ${runId}. Cleanup with RBAC_RICH_CLEANUP_RUN_ID=${runId} RUN_RBAC_E2E=1 npx playwright test ui/e2e/rbac/rbac-rich-local-regression-live.spec.ts`,
        );
      }
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (fixture && !keep) {
        try {
          await cleanupFixture(page, fixture);
          if (!primaryError) {
            await expectNoRunIdSelfCheckFindings(page, runId, "after fixture cleanup");
          }
        } catch (cleanupError) {
          if (!primaryError) throw cleanupError;
          console.warn(`Cleanup for ${runId} failed after primary error:`, cleanupError);
        }
      }
    }
  });
});
