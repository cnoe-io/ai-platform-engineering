// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Page } from "@playwright/test";

import { rbacEnvOrSkip } from "./_env";
import { installTestSession } from "./_helpers";

type ApiResult<T = unknown> = {
  status: number;
  body: T;
};

type DecisionBody = {
  decision?: "ALLOW" | "DENY";
  reason?: string;
  retriable?: boolean;
  debug?: {
    engine?: string;
    relation?: string;
    checked?: string[];
  };
};

type BatchBody = {
  results?: Array<{ id?: string; decision?: "ALLOW" | "DENY"; reason?: string }>;
  degraded?: boolean;
  retriable?: boolean;
};

type TupleKey = {
  user: string;
  relation: string;
  object: string;
};

type TupleBody = {
  success?: boolean;
  data?: {
    tuples?: Array<{ key?: TupleKey }>;
  };
};

type TupleCheckBody = {
  success?: boolean;
  data?: {
    tuple?: TupleKey;
    allowed?: boolean;
  };
};

type ResourceType = "agent" | "mcp_server";
type SubjectType = "user" | "service_account";

type GrantIntent = {
  resource: { type: ResourceType; id: string };
  grantee: { type: "user"; id: string } | { type: "service_account"; id: string } | { type: "everyone" };
  capability: "discover" | "read" | "use" | "invoke" | "manage";
};

async function fetchJson<T = unknown>(page: Page, path: string, init?: RequestInit): Promise<ApiResult<T>> {
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

async function postJson<T = unknown>(page: Page, path: string, body: unknown): Promise<ApiResult<T>> {
  return fetchJson<T>(page, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteJson<T = unknown>(page: Page, path: string, body: unknown): Promise<ApiResult<T>> {
  return fetchJson<T>(page, path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function decision(
  page: Page,
  input: {
    subjectType?: SubjectType;
    subjectId: string;
    resourceType: ResourceType;
    resourceId: string;
    action: "discover" | "read" | "use" | "invoke" | "manage";
  },
): Promise<ApiResult<DecisionBody>> {
  return postJson<DecisionBody>(page, "/api/authz/v1/decisions", {
    subject: { type: input.subjectType ?? "user", id: input.subjectId },
    resource: { type: input.resourceType, id: input.resourceId },
    action: input.action,
  });
}

async function expectDecision(
  page: Page,
  input: Parameters<typeof decision>[1],
  expected: "ALLOW" | "DENY",
): Promise<DecisionBody> {
  const result = await decision(page, input);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.decision, JSON.stringify(result.body)).toBe(expected);
  return result.body;
}

async function batchDecision(
  page: Page,
  input: {
    subjectId: string;
    resourceType: ResourceType;
    action: "read" | "use";
    ids: string[];
  },
): Promise<ApiResult<BatchBody>> {
  return postJson<BatchBody>(page, "/api/authz/v1/decisions/batch", {
    subject: { type: "user", id: input.subjectId },
    resource_type: input.resourceType,
    action: input.action,
    ids: input.ids,
  });
}

async function explain(
  page: Page,
  input: Parameters<typeof decision>[1],
): Promise<ApiResult<DecisionBody>> {
  return postJson<DecisionBody>(page, "/api/authz/v1/explain", {
    subject: { type: input.subjectType ?? "user", id: input.subjectId },
    resource: { type: input.resourceType, id: input.resourceId },
    action: input.action,
  });
}

async function grant(page: Page, intent: GrantIntent): Promise<ApiResult> {
  return postJson(page, "/api/authz/v1/grants", intent);
}

async function revoke(page: Page, intent: GrantIntent): Promise<ApiResult> {
  return deleteJson(page, "/api/authz/v1/grants", intent);
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

async function writeTuples(page: Page, body: { writes?: TupleKey[]; deletes?: TupleKey[] }): Promise<ApiResult> {
  return postJson(page, "/api/admin/openfga/tuples", body);
}

async function checkTuple(page: Page, tuple: TupleKey): Promise<ApiResult<TupleCheckBody>> {
  return postJson<TupleCheckBody>(page, "/api/admin/openfga/check", { tuple });
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe("RBAC live e2e — comprehensive OpenFGA semantics", () => {
  test("covers decisions, batch, explain, grants, revokes, delegation, wildcard, and tuple admin APIs", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const adminSubject = env.user.sub!;
    const suffix = uniqueSuffix();
    const secondarySubject = `e2e-secondary-${suffix}`;
    const thirdSubject = `e2e-third-${suffix}`;
    const serviceAccountSubject = `e2e-service-${suffix}`;
    const readOnlyAgent = `e2e-read-${suffix}`;
    const managedAgent = `e2e-managed-${suffix}`;
    const publicAgent = `e2e-public-${suffix}`;
    const rawTupleAgent = `e2e-raw-${suffix}`;
    const mcpServer = `e2e-mcp-${suffix}`;
    const deniedAgent = `e2e-denied-${suffix}`;

    const readGrant: GrantIntent = {
      resource: { type: "agent", id: readOnlyAgent },
      grantee: { type: "user", id: secondarySubject },
      capability: "read",
    };
    const manageGrant: GrantIntent = {
      resource: { type: "agent", id: managedAgent },
      grantee: { type: "user", id: secondarySubject },
      capability: "manage",
    };
    const delegatedUseGrant: GrantIntent = {
      resource: { type: "agent", id: managedAgent },
      grantee: { type: "user", id: thirdSubject },
      capability: "use",
    };
    const everyoneUseGrant: GrantIntent = {
      resource: { type: "agent", id: publicAgent },
      grantee: { type: "everyone" },
      capability: "use",
    };
    const serviceInvokeGrant: GrantIntent = {
      resource: { type: "mcp_server", id: mcpServer },
      grantee: { type: "service_account", id: serviceAccountSubject },
      capability: "invoke",
    };
    const rawTuple = {
      user: `user:${thirdSubject}`,
      relation: "user",
      object: `agent:${rawTupleAgent}`,
    };

    async function installAdminSession(): Promise<void> {
      await page.context().clearCookies();
      await installTestSession(page, env, {
        email: env.user.email,
        subject: adminSubject,
        role: "admin",
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
    }

    async function installSecondarySession(): Promise<void> {
      await page.context().clearCookies();
      await installTestSession(page, env, {
        email: `secondary-${suffix}@caipe.local`,
        subject: secondarySubject,
        role: "user",
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
    }

    try {
      await installAdminSession();

      await expectDecision(
        page,
        {
          subjectId: secondarySubject,
          resourceType: "agent",
          resourceId: readOnlyAgent,
          action: "read",
        },
        "DENY",
      );

      const invalidResource = await decision(page, {
        subjectId: secondarySubject,
        resourceType: "agent",
        resourceId: "bad:id",
        action: "read",
      });
      expect(invalidResource.status).toBe(400);
      expect(invalidResource.body.reason ?? invalidResource.body.code).toBeTruthy();

      const badBatch = await batchDecision(page, {
        subjectId: secondarySubject,
        resourceType: "agent",
        action: "read",
        ids: [],
      });
      expect(badBatch.status).toBe(400);

      const forbiddenEveryoneGrant = await grant(page, {
        resource: { type: "agent", id: publicAgent },
        grantee: { type: "everyone" },
        capability: "manage",
      });
      expect(forbiddenEveryoneGrant.status).toBe(400);

      const grantRead = await grant(page, readGrant);
      expect(grantRead.status, JSON.stringify(grantRead.body)).toBe(200);
      await expectTuple(page, { user: `user:${secondarySubject}`, relation: "reader", object: `agent:${readOnlyAgent}` }, true);
      await expectDecision(
        page,
        {
          subjectId: secondarySubject,
          resourceType: "agent",
          resourceId: readOnlyAgent,
          action: "read",
        },
        "ALLOW",
      );
      await expectDecision(
        page,
        {
          subjectId: secondarySubject,
          resourceType: "agent",
          resourceId: readOnlyAgent,
          action: "manage",
        },
        "DENY",
      );

      const batch = await batchDecision(page, {
        subjectId: secondarySubject,
        resourceType: "agent",
        action: "read",
        ids: [readOnlyAgent, deniedAgent],
      });
      expect(batch.status, JSON.stringify(batch.body)).toBe(200);
      expect(batch.body.degraded).toBeFalsy();
      expect(batch.body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: readOnlyAgent, decision: "ALLOW" }),
          expect.objectContaining({ id: deniedAgent, decision: "DENY" }),
        ]),
      );

      const explained = await explain(page, {
        subjectId: secondarySubject,
        resourceType: "agent",
        resourceId: readOnlyAgent,
        action: "read",
      });
      expect(explained.status, JSON.stringify(explained.body)).toBe(200);
      expect(explained.body.debug).toMatchObject({
        engine: "openfga",
        relation: "can_read",
      });
      expect(explained.body.debug?.checked?.[0]).toContain(`user:${secondarySubject} can_read agent:${readOnlyAgent}`);

      await installSecondarySession();
      const crossSubjectAsNonAuditor = await decision(page, {
        subjectId: adminSubject,
        resourceType: "agent",
        resourceId: readOnlyAgent,
        action: "read",
      });
      expect(crossSubjectAsNonAuditor.status).toBe(403);

      const unauthorizedGrant = await grant(page, {
        resource: { type: "agent", id: deniedAgent },
        grantee: { type: "user", id: thirdSubject },
        capability: "use",
      });
      expect(unauthorizedGrant.status).toBe(403);

      await installAdminSession();
      const grantManage = await grant(page, manageGrant);
      expect(grantManage.status, JSON.stringify(grantManage.body)).toBe(200);

      await installSecondarySession();
      const delegatedGrant = await grant(page, delegatedUseGrant);
      expect(delegatedGrant.status, JSON.stringify(delegatedGrant.body)).toBe(200);
      await installAdminSession();
      await expectDecision(
        page,
        {
          subjectId: thirdSubject,
          resourceType: "agent",
          resourceId: managedAgent,
          action: "use",
        },
        "ALLOW",
      );
      await installSecondarySession();
      const delegatedRevoke = await revoke(page, delegatedUseGrant);
      expect(delegatedRevoke.status, JSON.stringify(delegatedRevoke.body)).toBe(200);
      await installAdminSession();
      await expectDecision(
        page,
        {
          subjectId: thirdSubject,
          resourceType: "agent",
          resourceId: managedAgent,
          action: "use",
        },
        "DENY",
      );

      await installAdminSession();
      const publicGrant = await grant(page, everyoneUseGrant);
      expect(publicGrant.status, JSON.stringify(publicGrant.body)).toBe(200);
      await expectTuple(page, { user: "user:*", relation: "user", object: `agent:${publicAgent}` }, true);
      await expectDecision(
        page,
        {
          subjectId: thirdSubject,
          resourceType: "agent",
          resourceId: publicAgent,
          action: "use",
        },
        "ALLOW",
      );

      const serviceGrant = await grant(page, serviceInvokeGrant);
      expect(serviceGrant.status, JSON.stringify(serviceGrant.body)).toBe(200);
      await expectDecision(
        page,
        {
          subjectType: "service_account",
          subjectId: serviceAccountSubject,
          resourceType: "mcp_server",
          resourceId: mcpServer,
          action: "invoke",
        },
        "ALLOW",
      );

      const rawWrite = await writeTuples(page, { writes: [rawTuple] });
      expect(rawWrite.status, JSON.stringify(rawWrite.body)).toBe(200);
      await expectTuple(page, rawTuple, true);
      const rawCheck = await checkTuple(page, rawTuple);
      expect(rawCheck.status, JSON.stringify(rawCheck.body)).toBe(200);
      expect(rawCheck.body.data?.allowed).toBe(true);

      const materializedWrite = await writeTuples(page, {
        writes: [{ user: `user:${thirdSubject}`, relation: "can_read", object: `agent:${rawTupleAgent}` }],
      });
      expect(materializedWrite.status).toBe(400);

      const revokeRead = await revoke(page, readGrant);
      expect(revokeRead.status, JSON.stringify(revokeRead.body)).toBe(200);
      await expectTuple(page, { user: `user:${secondarySubject}`, relation: "reader", object: `agent:${readOnlyAgent}` }, false);
      await expectDecision(
        page,
        {
          subjectId: secondarySubject,
          resourceType: "agent",
          resourceId: readOnlyAgent,
          action: "read",
        },
        "DENY",
      );
    } finally {
      await installAdminSession().catch(() => undefined);
      await revoke(page, readGrant).catch(() => undefined);
      await revoke(page, manageGrant).catch(() => undefined);
      await revoke(page, delegatedUseGrant).catch(() => undefined);
      await revoke(page, everyoneUseGrant).catch(() => undefined);
      await revoke(page, serviceInvokeGrant).catch(() => undefined);
      await writeTuples(page, { deletes: [rawTuple] }).catch(() => undefined);
    }
  });
});
