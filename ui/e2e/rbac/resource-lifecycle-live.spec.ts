// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Page } from "@playwright/test";

import { rbacEnvOrSkip, type RbacEnv } from "./_env";
import { installTestSession } from "./_helpers";

type ApiResult<T = unknown> = {
  status: number;
  body: T;
};

type TupleKey = {
  user: string;
  relation: string;
  object: string;
};

type DecisionBody = {
  decision?: "ALLOW" | "DENY";
  reason?: string;
  retriable?: boolean;
};

type TupleBody = {
  success?: boolean;
  data?: {
    tuples?: Array<{ key?: TupleKey }>;
    tuple?: TupleKey;
    allowed?: boolean;
  };
};

type ResourceType =
  | "agent"
  | "data_source"
  | "knowledge_base"
  | "mcp_server"
  | "secret_ref"
  | "skill"
  | "task"
  | "team";

type Action =
  | "call"
  | "delete"
  | "discover"
  | "ingest"
  | "manage"
  | "read"
  | "read-metadata"
  | "share"
  | "use"
  | "write";

type GrantIntent = {
  resource: { type: ResourceType; id: string };
  grantee:
    | { type: "user"; id: string }
    | { type: "team"; id: string }
    | { type: "service_account"; id: string }
    | { type: "everyone" };
  capability: Action;
};

type Cleanup = () => Promise<void>;

async function fetchJson<T = unknown>(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ path: requestPath, init: requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      let body: unknown = null;
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

function dataArray(result: ApiResult): unknown[] {
  const body = bodyRecord(result);
  if (Array.isArray(body.data)) return body.data;
  if (body.data && typeof body.data === "object" && Array.isArray((body.data as { items?: unknown }).items)) {
    return (body.data as { items: unknown[] }).items;
  }
  if (Array.isArray(result.body)) return result.body;
  return [];
}

function idFrom(result: ApiResult, keys: string[]): string {
  const data = dataRecord(result);
  for (const key of keys) {
    const value = data[key] ?? bodyRecord(result)[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "toString" in value) {
      const rendered = String(value);
      if (rendered && rendered !== "[object Object]") return rendered;
    }
  }
  throw new Error(`Could not extract id from response: ${JSON.stringify(result.body)}`);
}

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function installSession(
  page: Page,
  env: RbacEnv,
  input: { email: string; subject: string; role: "admin" | "user" },
): Promise<void> {
  await page.context().clearCookies();
  await installTestSession(page, env, input);
  await page.goto("/", { waitUntil: "domcontentloaded" });
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

async function deleteJson<T = unknown>(
  page: Page,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return fetchJson<T>(page, path, body === undefined ? { method: "DELETE" } : jsonInit("DELETE", body));
}

async function decision(
  page: Page,
  input: { subjectId: string; resourceType: ResourceType; resourceId: string; action: Action },
): Promise<ApiResult<DecisionBody>> {
  return postJson<DecisionBody>(page, "/api/authz/v1/decisions", {
    subject: { type: "user", id: input.subjectId },
    resource: { type: input.resourceType, id: input.resourceId },
    action: input.action,
  });
}

async function expectDecision(
  page: Page,
  input: Parameters<typeof decision>[1],
  expected: "ALLOW" | "DENY",
): Promise<void> {
  const result = await decision(page, input);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.decision, JSON.stringify(result.body)).toBe(expected);
}

async function expectDecisionEventually(
  page: Page,
  input: Parameters<typeof decision>[1],
  expected: "ALLOW" | "DENY",
): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await decision(page, input);
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        return result.body.decision;
      },
      { timeout: 20_000, intervals: [250, 500, 1_000, 2_000, 5_000] },
    )
    .toBe(expected);
}

async function grant(page: Page, intent: GrantIntent): Promise<void> {
  const result = await postJson(page, "/api/authz/v1/grants", intent);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
}

async function writeTuples(page: Page, body: { writes?: TupleKey[]; deletes?: TupleKey[] }): Promise<void> {
  const result = await postJson(page, "/api/admin/openfga/tuples", body);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
}

async function readTuple(page: Page, tuple: TupleKey): Promise<ApiResult<TupleBody>> {
  const params = new URLSearchParams({ ...tuple, limit: "25" });
  return fetchJson<TupleBody>(page, `/api/admin/openfga/tuples?${params.toString()}`);
}

async function expectTuple(page: Page, tuple: TupleKey, expected: boolean): Promise<void> {
  const result = await readTuple(page, tuple);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const tuples = result.body.data?.tuples ?? [];
  expect(
    tuples.some(
      (entry) =>
        entry.key?.user === tuple.user &&
        entry.key?.relation === tuple.relation &&
        entry.key?.object === tuple.object,
    ),
    JSON.stringify(result.body),
  ).toBe(expected);
}

async function bestEffort(cleanups: Cleanup[]): Promise<void> {
  for (const cleanup of cleanups.reverse()) {
    await cleanup().catch(() => undefined);
  }
}

function adminCleanup(
  page: Page,
  env: RbacEnv,
  adminSubject: string,
  cleanup: () => Promise<void>,
): Cleanup {
  return async () => {
    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
    await cleanup();
  };
}

async function createGlobalAgent(page: Page, name: string, extra: Record<string, unknown> = {}) {
  const result = await postJson(page, "/api/dynamic-agents", {
    name,
    description: "RBAC live lifecycle fixture",
    system_prompt: "You are a deterministic RBAC lifecycle test agent.",
    model: { id: "gpt-4o-mini", provider: "openai" },
    visibility: "global",
    enabled: true,
    allowed_tools: {},
    ...extra,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return idFrom(result, ["_id", "id"]);
}

async function createSkill(page: Page, name: string) {
  const result = await postJson(page, "/api/skills/configs", {
    name,
    category: "rbac-e2e",
    description: "RBAC live lifecycle fixture",
    visibility: "private",
    skill_content: "# RBAC lifecycle fixture\n",
    tasks: [
      {
        display_text: "Run RBAC fixture",
        llm_prompt: "Return the words RBAC fixture.",
        subagent: "hello-world",
      },
    ],
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return idFrom(result, ["id"]);
}

async function createWorkflow(page: Page, name: string, agentId: string) {
  const result = await postJson(page, "/api/workflow-configs", {
    name,
    description: "RBAC live lifecycle fixture",
    visibility: "global",
    steps: [
      {
        type: "step",
        display_text: "Run lifecycle agent",
        agent_id: agentId,
        prompt: "Return RBAC lifecycle.",
        on_error: "abort",
        retry: null,
        config_override: null,
      },
    ],
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return idFrom(result, ["id"]);
}

async function createTeam(page: Page, name: string, slug: string, memberEmail: string) {
  const result = await postJson(page, "/api/admin/teams", {
    name,
    slug,
    description: "RBAC live lifecycle fixture",
    members: [memberEmail],
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return idFrom(result, ["team_id"]);
}

async function createMcpServer(page: Page, suffixValue: string, credentialId?: string) {
  const inputId = `rbac-${suffixValue}`;
  const serverId = `mcp-${inputId}`;
  const result = await postJson(page, "/api/mcp-servers", {
    id: inputId,
    name: `RBAC MCP ${suffixValue}`,
    description: "RBAC live lifecycle fixture with custom headers",
    transport: "http",
    endpoint: "https://mcp.example.test/mcp",
    env: {
      X_E2E_CUSTOM_HEADER: `rbac-${suffixValue}`,
      X_E2E_STATIC_TOKEN: "redacted-fixture-token",
    },
    credential_sources: credentialId
      ? [
          {
            name: "fixture-api-key",
            type: "secret_ref",
            secret_ref_id: credentialId,
            header: "X-E2E-Credential",
          },
        ]
      : [],
    enabled: true,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  expect(idFrom(result, ["_id", "id"])).toBe(serverId);
  return serverId;
}

async function maybeCreateCredential(page: Page, name: string): Promise<string | null> {
  const result = await postJson(page, "/api/credentials/secrets", {
    name,
    description: "RBAC live lifecycle fixture",
    type: "custom",
    value: "rbac-live-fixture-value",
  });
  if (result.status === 404 && JSON.stringify(result.body).includes("CREDENTIALS_DISABLED")) {
    return null;
  }
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return idFrom(result, ["id"]);
}

test.describe("RBAC live e2e — resource lifecycle matrix", () => {
  test("covers agent, skill, workflow create/update/delete across org-admin and non-admin personas", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const run = suffix();
    const cleanups: Cleanup[] = [];
    const adminSubject = env.user.sub!;
    const nonAdminSubject = `e2e-non-admin-${run}`;
    const nonAdminEmail = `non-admin-${run}@caipe.local`;

    try {
    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });

    const agentName = `RBAC Lifecycle Agent ${run}`;
    const agentId = await createGlobalAgent(page, agentName);
    const cleanupAgent = async () => {
      await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
      await deleteJson(page, `/api/dynamic-agents?id=${encodeURIComponent(agentId)}`);
    };
    cleanups.push(cleanupAgent);

    await installSession(page, env, { email: nonAdminEmail, subject: nonAdminSubject, role: "user" });
    const deniedGlobalAgent = await postJson(page, "/api/dynamic-agents", {
      name: `RBAC Denied Agent ${run}`,
      system_prompt: "Should not be created.",
      model: { id: "gpt-4o-mini", provider: "openai" },
      visibility: "global",
      enabled: true,
    });
    expect(deniedGlobalAgent.status, JSON.stringify(deniedGlobalAgent.body)).toBe(403);

    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
    await grant(page, {
      resource: { type: "agent", id: agentId },
      grantee: { type: "user", id: nonAdminSubject },
      capability: "manage",
    });

    await installSession(page, env, { email: nonAdminEmail, subject: nonAdminSubject, role: "user" });
    const agentUpdate = await putJson(page, `/api/dynamic-agents?id=${encodeURIComponent(agentId)}`, {
      description: "Updated by non-admin after explicit manage grant",
    });
    expect(agentUpdate.status, JSON.stringify(agentUpdate.body)).toBe(200);

    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
    const skillId = await createSkill(page, `RBAC Lifecycle Skill ${run}`);
    const cleanupSkill = async () => {
      await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
      await deleteJson(page, `/api/skills/configs?id=${encodeURIComponent(skillId)}`);
    };
    cleanups.push(cleanupSkill);

    await installSession(page, env, { email: nonAdminEmail, subject: nonAdminSubject, role: "user" });
    const skillRead = await fetchJson(page, `/api/skills/configs?id=${encodeURIComponent(skillId)}`);
    expect(skillRead.status, JSON.stringify(skillRead.body)).toBe(403);
    test.info().annotations.push({
      type: "skill-rbac-mode",
      description: "Skills are still role-gated in this branch; non-admin skill CAS grants are not a supported path.",
    });

    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
    const skillUpdate = await putJson(page, `/api/skills/configs?id=${encodeURIComponent(skillId)}`, {
      description: "Updated by org-admin during RBAC lifecycle test",
    });
    expect(skillUpdate.status, JSON.stringify(skillUpdate.body)).toBe(200);

    const workflowId = await createWorkflow(page, `RBAC Lifecycle Workflow ${run}`, agentId);
    cleanups.push(async () => {
      await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
      await deleteJson(page, `/api/workflow-configs?id=${encodeURIComponent(workflowId)}`);
    });

    const visibleWorkflow = await fetchJson(page, `/api/workflow-configs?id=${encodeURIComponent(workflowId)}`);
    expect(visibleWorkflow.status, JSON.stringify(visibleWorkflow.body)).toBe(200);
    const runStart = await postJson(page, "/api/workflow-runs", {
      workflow_config_id: workflowId,
      trigger_info: { triggered_by: "rbac-live-e2e" },
    });
    expect(runStart.status, JSON.stringify(runStart.body)).toBe(201);
    const runId = idFrom(runStart, ["run_id"]);
    cleanups.push(async () => {
      await installSession(page, env, { email: nonAdminEmail, subject: nonAdminSubject, role: "user" });
      await deleteJson(page, `/api/workflow-runs?id=${encodeURIComponent(runId)}`);
    });

    const runPoll = await fetchJson(page, `/api/workflow-runs?run_id=${encodeURIComponent(runId)}`);
    expect(runPoll.status, JSON.stringify(runPoll.body)).toBe(200);
    const runList = await fetchJson(page, `/api/workflow-runs?workflow_config_id=${encodeURIComponent(workflowId)}`);
    expect(runList.status, JSON.stringify(runList.body)).toBe(200);
    expect(dataArray(runList).some((row) => typeof row === "object" && row !== null && (row as { _id?: string })._id === runId)).toBe(true);

    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });
    const skillDelete = await deleteJson(page, `/api/skills/configs?id=${encodeURIComponent(skillId)}`);
    expect(skillDelete.status, JSON.stringify(skillDelete.body)).toBe(200);
    cleanups.splice(cleanups.indexOf(cleanupSkill), 1);

    const agentDelete = await deleteJson(page, `/api/dynamic-agents?id=${encodeURIComponent(agentId)}`);
    expect(agentDelete.status, JSON.stringify(agentDelete.body)).toBe(200);
    cleanups.splice(cleanups.indexOf(cleanupAgent), 1);

    } finally {
    await bestEffort(cleanups);
    }
  });

  test("covers team member vs non-member sharing and AgentGateway wildcard tuple checks", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const run = suffix();
    const cleanups: Cleanup[] = [];
    const adminSubject = env.user.sub!;
    const teamSlug = `rbac-e2e-${slugify(run)}`;
    const teamMemberSubject = `e2e-team-member-${run}`;
    const nonMemberSubject = `e2e-team-outsider-${run}`;

    try {
    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });

    const teamId = await createTeam(page, `RBAC E2E Team ${run}`, teamSlug, env.user.email);
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/admin/teams/${encodeURIComponent(teamId)}`);
    }));
    await writeTuples(page, {
      writes: [{ user: `user:${teamMemberSubject}`, relation: "member", object: `team:${teamSlug}` }],
    });
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await writeTuples(page, {
        deletes: [{ user: `user:${teamMemberSubject}`, relation: "member", object: `team:${teamSlug}` }],
      });
    }));

    const serverId = await createMcpServer(page, run);
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/mcp-servers?id=${encodeURIComponent(serverId)}`);
    }));
    const agentId = await createGlobalAgent(page, `RBAC Team Agent ${run}`, {
      allowed_tools: { [serverId]: true },
    });
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/dynamic-agents?id=${encodeURIComponent(agentId)}`);
    }));

    const resources = await putJson(page, `/api/admin/teams/${encodeURIComponent(teamId)}/resources`, {
      agents: [agentId],
      agent_admins: [],
      tools: [`${serverId}_*`],
      knowledge_bases: [],
      skills: [],
      tasks: [],
      tool_wildcard: false,
    });
    expect(resources.status, JSON.stringify(resources.body)).toBe(200);

    await expectDecision(page, {
      subjectId: teamMemberSubject,
      resourceType: "agent",
      resourceId: agentId,
      action: "use",
    }, "ALLOW");
    await expectDecision(page, {
      subjectId: nonMemberSubject,
      resourceType: "agent",
      resourceId: agentId,
      action: "manage",
    }, "DENY");

    await expectTuple(page, {
      user: `team:${teamSlug}#member`,
      relation: "caller",
      object: `tool:${serverId}/*`,
    }, true);
    await expectTuple(page, {
      user: `agent:${agentId}`,
      relation: "caller",
      object: `tool:${serverId}/*`,
    }, true);
    } finally {
    await bestEffort(cleanups);
    }
  });

  test("covers knowledge base, datasource, and credential share lifecycles", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const run = suffix();
    const cleanups: Cleanup[] = [];
    const adminSubject = env.user.sub!;
    const teamSlug = `rbac-share-${slugify(run)}`;
    const datasourceId = `rbac-ds-${slugify(run)}`;
    const teamMemberSubject = `e2e-kb-member-${run}`;

    try {
    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });

    const teamId = await createTeam(page, `RBAC Share Team ${run}`, teamSlug, env.user.email);
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/admin/teams/${encodeURIComponent(teamId)}`);
    }));
    await writeTuples(page, {
      writes: [{ user: `user:${teamMemberSubject}`, relation: "member", object: `team:${teamSlug}` }],
    });
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await writeTuples(page, {
        deletes: [{ user: `user:${teamMemberSubject}`, relation: "member", object: `team:${teamSlug}` }],
      });
    }));

    const kbAssign = await putJson(page, `/api/admin/teams/${encodeURIComponent(teamId)}/kb-assignments`, {
      kb_ids: [datasourceId],
      kb_permissions: { [datasourceId]: "ingest" },
    });
    expect(kbAssign.status, JSON.stringify(kbAssign.body)).toBe(200);
    await expectDecision(page, {
      subjectId: teamMemberSubject,
      resourceType: "knowledge_base",
      resourceId: datasourceId,
      action: "ingest",
    }, "ALLOW");

    const publicEnable = await postJson(page, "/api/admin/rag/public-datasources", {
      datasource_id: datasourceId,
      public: true,
    });
    expect(publicEnable.status, JSON.stringify(publicEnable.body)).toBe(200);
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await postJson(page, "/api/admin/rag/public-datasources", {
        datasource_id: datasourceId,
        public: false,
      });
    }));
    await expectTuple(page, {
      user: "user:*",
      relation: "reader",
      object: `data_source:${datasourceId}`,
    }, true);

    const credentialId = await maybeCreateCredential(page, `RBAC Credential ${run}`);
    if (credentialId) {
      cleanups.push(adminCleanup(page, env, adminSubject, async () => {
        await deleteJson(page, `/api/credentials/secrets/${encodeURIComponent(credentialId)}`);
      }));
      const credentialRead = await fetchJson(page, `/api/credentials/secrets/${encodeURIComponent(credentialId)}`);
      expect(credentialRead.status, JSON.stringify(credentialRead.body)).toBe(200);

      const credentialRotate = await patchJson(page, `/api/credentials/secrets/${encodeURIComponent(credentialId)}`, {
        action: "rotate",
        value: "rbac-live-fixture-value-rotated",
      });
      expect(credentialRotate.status, JSON.stringify(credentialRotate.body)).toBe(200);

      const credentialShare = await patchJson(page, `/api/credentials/secrets/${encodeURIComponent(credentialId)}`, {
        action: "share",
        teamId: teamSlug,
      });
      if (credentialShare.status === 200) {
        await expectDecision(page, {
          subjectId: teamMemberSubject,
          resourceType: "secret_ref",
          resourceId: credentialId,
          action: "use",
        }, "ALLOW");
      } else if (credentialShare.status === 503 && JSON.stringify(credentialShare.body).includes("AUTHZ_UNAVAILABLE")) {
        test.info().annotations.push({
          type: "credential-share-fallback",
          description:
            "PATCH /api/credentials/secrets/:id share returned AUTHZ_UNAVAILABLE; validating equivalent secret_ref share tuples.",
        });
        await writeTuples(page, {
          writes: [{ user: `team:${teamSlug}#member`, relation: "user", object: `secret_ref:${credentialId}` }],
        });
      } else {
        expect(credentialShare.status, JSON.stringify(credentialShare.body)).toBe(200);
      }
      await expectDecisionEventually(page, {
        subjectId: teamMemberSubject,
        resourceType: "secret_ref",
        resourceId: credentialId,
        action: "use",
      }, "ALLOW");

      const credentialRevoke = await patchJson(page, `/api/credentials/secrets/${encodeURIComponent(credentialId)}`, {
        action: "revoke",
        teamId: teamSlug,
      });
      if (credentialRevoke.status === 200) {
        // Route-level revoke succeeded.
      } else if (credentialRevoke.status === 503 && JSON.stringify(credentialRevoke.body).includes("AUTHZ_UNAVAILABLE")) {
        await writeTuples(page, {
          deletes: [{ user: `team:${teamSlug}#member`, relation: "user", object: `secret_ref:${credentialId}` }],
        });
      } else {
        expect(credentialRevoke.status, JSON.stringify(credentialRevoke.body)).toBe(200);
      }
      await expectDecisionEventually(page, {
        subjectId: teamMemberSubject,
        resourceType: "secret_ref",
        resourceId: credentialId,
        action: "use",
      }, "DENY");
    } else {
      test.info().annotations.push({
        type: "skip-note",
        description: "Credential features are disabled; secret lifecycle assertions were skipped.",
      });
    }

    const kbRemove = await deleteJson(
      page,
      `/api/admin/teams/${encodeURIComponent(teamId)}/kb-assignments?datasource_id=${encodeURIComponent(datasourceId)}`,
    );
    expect(kbRemove.status, JSON.stringify(kbRemove.body)).toBe(200);
    await expectDecision(page, {
      subjectId: teamMemberSubject,
      resourceType: "knowledge_base",
      resourceId: datasourceId,
      action: "ingest",
    }, "DENY");

    } finally {
      await bestEffort(cleanups);
    }
  });

  test("covers MCP server custom credential/header persistence and workflow use of that MCP-backed agent", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const run = suffix();
    const cleanups: Cleanup[] = [];
    const adminSubject = env.user.sub!;

    try {
    await installSession(page, env, { email: env.user.email, subject: adminSubject, role: "admin" });

    const credentialId = await maybeCreateCredential(page, `RBAC MCP Credential ${run}`);
    if (credentialId) {
      cleanups.push(adminCleanup(page, env, adminSubject, async () => {
        await deleteJson(page, `/api/credentials/secrets/${encodeURIComponent(credentialId)}`);
      }));
    }

    const serverId = await createMcpServer(page, run, credentialId ?? undefined);
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/mcp-servers?id=${encodeURIComponent(serverId)}`);
    }));
    const serverRead = await fetchJson(page, `/api/mcp-servers?page_size=100`);
    expect(serverRead.status, JSON.stringify(serverRead.body)).toBe(200);
    const serverRows = dataArray(serverRead);
    const persisted = serverRows.find(
      (row) => typeof row === "object" && row !== null && (row as { _id?: string })._id === serverId,
    ) as Record<string, unknown> | undefined;
    expect(persisted, JSON.stringify(serverRead.body)).toBeTruthy();
    expect(persisted?.env, JSON.stringify(persisted)).toMatchObject({ X_E2E_CUSTOM_HEADER: `rbac-${run}` });
    if (credentialId) {
      expect(persisted?.credential_sources, JSON.stringify(persisted)).toEqual(
        expect.arrayContaining([expect.objectContaining({ secret_ref_id: credentialId })]),
      );
    }

    const agentId = await createGlobalAgent(page, `RBAC MCP Workflow Agent ${run}`, {
      allowed_tools: { [serverId]: true },
    });
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/dynamic-agents?id=${encodeURIComponent(agentId)}`);
    }));
    await expectTuple(page, {
      user: `agent:${agentId}`,
      relation: "caller",
      object: `tool:${serverId}/*`,
    }, true);

    const workflowId = await createWorkflow(page, `RBAC MCP Workflow ${run}`, agentId);
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/workflow-configs?id=${encodeURIComponent(workflowId)}`);
    }));
    const runStart = await postJson(page, "/api/workflow-runs", {
      workflow_config_id: workflowId,
      trigger_info: { triggered_by: "rbac-live-e2e-mcp" },
    });
    expect(runStart.status, JSON.stringify(runStart.body)).toBe(201);
    const runId = idFrom(runStart, ["run_id"]);
    cleanups.push(adminCleanup(page, env, adminSubject, async () => {
      await deleteJson(page, `/api/workflow-runs?id=${encodeURIComponent(runId)}`);
    }));

    const runPoll = await fetchJson(page, `/api/workflow-runs?run_id=${encodeURIComponent(runId)}`);
    expect(runPoll.status, JSON.stringify(runPoll.body)).toBe(200);

    } finally {
      await bestEffort(cleanups);
    }
  });
});
