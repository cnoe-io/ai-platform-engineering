// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Page } from "@playwright/test";

import { rbacEnvOrSkip } from "./_env";
import { dismissReleaseUpgradeDialog, installTestSession } from "./_helpers";

type SessionBody = {
  sub?: string;
  user?: { email?: string | null };
};

type ApiResult = {
  status: number;
  body: unknown;
};

type DecisionBody = {
  decision?: string;
  reason?: string;
  retriable?: boolean;
};

type TupleBody = {
  success?: boolean;
  data?: {
    tuples?: Array<{
      key?: {
        user?: string;
        relation?: string;
        object?: string;
      };
    }>;
  };
};

async function fetchJson(page: Page, path: string, init?: RequestInit): Promise<ApiResult> {
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
  );
}

async function currentSession(page: Page): Promise<SessionBody> {
  const result = await fetchJson(page, "/api/auth/session");
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body as SessionBody;
}

async function expectCasAllow(
  page: Page,
  input: { subjectId: string; serverId: string; action: "read" | "manage" },
): Promise<void> {
  const result = await fetchJson(page, "/api/authz/v1/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: { type: "user", id: input.subjectId },
      resource: { type: "mcp_server", id: input.serverId },
      action: input.action,
    }),
  });

  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const body = result.body as DecisionBody;
  expect(body.decision, JSON.stringify(body)).toBe("ALLOW");
}

async function expectOpenFgaTuple(
  page: Page,
  tuple: { user: string; relation: string; object: string },
): Promise<void> {
  const params = new URLSearchParams({
    user: tuple.user,
    relation: tuple.relation,
    object: tuple.object,
    limit: "25",
  });
  const result = await fetchJson(page, `/api/admin/openfga/tuples?${params.toString()}`);
  expect(result.status, JSON.stringify(result.body)).toBe(200);

  const body = result.body as TupleBody;
  const tuples = body.data?.tuples ?? [];
  expect(
    tuples.some(
      (entry) =>
        entry.key?.user === tuple.user &&
        entry.key?.relation === tuple.relation &&
        entry.key?.object === tuple.object,
    ),
    JSON.stringify(body),
  ).toBe(true);
}

async function bestEffortDeleteMcpServer(page: Page, serverId: string): Promise<void> {
  await fetchJson(page, `/api/mcp-servers?id=${encodeURIComponent(serverId)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

async function expectCreateServerButtonReady(page: Page) {
  const createButton = page.getByRole("button", { name: /create server/i });

  await expect
    .poll(
      async () => {
        await dismissReleaseUpgradeDialog(page);
        return createButton.isEnabled().catch(() => false);
      },
      {
        message: "Create Server button should be available after transient release dialogs are dismissed",
        timeout: 15_000,
      },
    )
    .toBe(true);

  return createButton;
}

test.describe("RBAC live e2e — MCP server create visibility", () => {
  test("creating an MCP server writes OpenFGA grants and survives the list filter", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputId = `e2e-${suffix}`;
    const serverId = `mcp-${inputId}`;
    const displayName = `E2E MCP ${suffix}`;
    const object = `mcp_server:${serverId}`;
    const orgKey = process.env.CAIPE_ORG_KEY?.trim() || "caipe";

    await installTestSession(page, env, {
      email: env.user.email,
      subject: env.user.sub!,
      role: "admin",
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const session = await currentSession(page);
    expect(session.sub, JSON.stringify(session)).toBeTruthy();
    const subjectId = session.sub!;

    try {
      await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
      await dismissReleaseUpgradeDialog(page);

      await page.getByRole("button", { name: /add server/i }).first().click();
      await dismissReleaseUpgradeDialog(page);
      await expect(page.getByText(/add mcp server/i)).toBeVisible({ timeout: 15_000 });

      await page.getByPlaceholder(/github, filesystem, postgres/i).fill(inputId);
      await page.getByPlaceholder(/GitHub MCP Server/i).fill(displayName);
      await page.getByPlaceholder(/localhost:3000\/sse/i).fill("https://mcp.example.test/mcp");

      const createResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/mcp-servers",
      );
      const createButton = await expectCreateServerButtonReady(page);
      await createButton.click();
      expect((await createResponse).status()).toBe(201);

      await expect(page.getByText(displayName)).toBeVisible({ timeout: 15_000 });

      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByText(displayName)).toBeVisible({ timeout: 15_000 });

      await expectCasAllow(page, { subjectId, serverId, action: "read" });
      await expectCasAllow(page, { subjectId, serverId, action: "manage" });

      await expectOpenFgaTuple(page, {
        user: `user:${subjectId}`,
        relation: "owner",
        object,
      });
      await expectOpenFgaTuple(page, {
        user: `organization:${orgKey}#admin`,
        relation: "manager",
        object,
      });
    } finally {
      await bestEffortDeleteMcpServer(page, serverId);
    }
  });
});
