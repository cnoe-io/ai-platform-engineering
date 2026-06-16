// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const adminSession = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

function decisionRow(
  action: string,
  decision: "ALLOW" | "DENY",
  options: {
    supported?: boolean;
    via?: "tuple" | "org_admin" | null;
    revocable?: boolean;
    present?: boolean;
    reason?: string;
  } = {},
) {
  const relation = `can_${action.replace(/-/g, "_")}`;
  return {
    action,
    supported: options.supported ?? true,
    decision,
    reason: options.reason ?? (decision === "ALLOW" ? "OK" : "NO_CAPABILITY"),
    retriable: false,
    via: options.via ?? (decision === "ALLOW" ? "tuple" : null),
    directGrant: {
      tuple: `user:user-123 ${relation} agent:agent-private`,
      present: options.present ?? decision === "ALLOW",
      revocable: options.revocable ?? decision === "ALLOW",
    },
    debug: {
      engine: "openfga",
      relation,
      checked: [`user:user-123 ${relation} agent:agent-private`],
      store: "playwright",
    },
  };
}

function permissionResults(version: number) {
  const useDecision = version === 2 ? "ALLOW" : "DENY";
  return [
    decisionRow("use", useDecision),
    decisionRow("manage", "ALLOW", { revocable: true }),
    decisionRow("share", "ALLOW", { present: false, revocable: false }),
    decisionRow("invoke", "DENY", {
      supported: false,
      present: false,
      reason: "capability is not supported for this resource type",
    }),
  ];
}

function auditRecords() {
  return [
    {
      ts: "2026-06-12T16:28:11.000Z",
      type: "cas_grant",
      outcome: "success",
      user_email: adminSession.email,
      action: "use",
      resource_ref: "agent:agent-private",
      resource_type: "agent",
      resource_id: "agent-private",
      operation: "grant",
      grantee_ref: "user:*",
      caller_ref: `user:${adminSession.email}`,
      component: "cas",
      source: "cas",
      pdp: "openfga",
      decision_via: "tuple",
      reason_code: "OK",
      correlation_id: "corr-grant",
      tenant_id: "default",
      duration_ms: 18,
    },
    {
      ts: "2026-06-12T16:27:54.000Z",
      type: "cas_decision",
      outcome: "deny",
      user_email: "non-manager@caipe.local",
      action: "manage",
      resource_ref: "agent:agent-private",
      resource_type: "agent",
      resource_id: "agent-private",
      component: "cas",
      source: "cas",
      pdp: "openfga",
      decision_via: "openfga",
      reason_code: "NO_CAPABILITY",
      correlation_id: "corr-deny",
      tenant_id: "default",
    },
  ];
}

test.describe("mocked RBAC admin browser regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("permissions tool refreshes after grant and revoke and greys unsupported capabilities", async ({
    page,
  }) => {
    const explainRequests: unknown[] = [];
    const grantRequests: unknown[] = [];
    const revokeRequests: unknown[] = [];
    let explainVersion = 0;

    const permissionsHandler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/admin/users") {
        await fulfillJson(route, {
          users: [{ id: "user-123", sub: "user-123", email: "user-123@example.com" }],
        });
        return true;
      }

      if (path === "/api/admin/authz/resources" && method === "GET") {
        expect(url.searchParams.get("type")).toBe("agent");
        await fulfillJson(route, {
          resources: [{ id: "agent-private", label: "Private agent" }],
        });
        return true;
      }

      if (path === "/api/admin/authz/explain" && method === "POST") {
        explainRequests.push(await postJson(route));
        explainVersion += 1;
        await fulfillJson(route, { results: permissionResults(explainVersion) });
        return true;
      }

      if (path === "/api/admin/authz/grants" && method === "POST") {
        grantRequests.push(await postJson(route));
        await fulfillJson(route, { success: true });
        return true;
      }

      if (path === "/api/admin/authz/grants" && method === "DELETE") {
        revokeRequests.push(await postJson(route));
        await fulfillJson(route, { success: true });
        return true;
      }

      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [permissionsHandler],
    });

    await page.goto("/admin?cat=security&tab=cas-permissions-tool", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "Permissions Tool" })).toBeVisible();
    await page.getByLabel("Subject", { exact: true }).fill("user-123");
    await page.getByLabel("Resource", { exact: true }).fill("agent-private");
    await page.getByRole("button", { name: /explain all actions/i }).click();

    await expect.poll(() => explainRequests.length).toBe(1);
    expect(explainRequests[0]).toMatchObject({
      subject: { type: "user", id: "user-123" },
      resource: { type: "agent", id: "agent-private" },
    });
    await expect(page.getByTestId("permission-row-use")).toContainText("DENY");
    await expect(page.getByTestId("permission-row-share")).toContainText("Inherited");
    await expect(page.getByTestId("permission-row-invoke")).toContainText("Not supported");
    await expect(page.getByTestId("permission-row-invoke").getByRole("button")).toHaveCount(0);

    await page.getByTestId("permission-row-use").getByRole("button", { name: "Grant" }).click();
    await expect.poll(() => grantRequests.length).toBe(1);
    expect(grantRequests[0]).toMatchObject({
      resource: { type: "agent", id: "agent-private" },
      grantee: { type: "user", id: "user-123" },
      capability: "use",
    });
    await expect(page.getByTestId("permission-row-use")).toContainText("ALLOW");

    await page.getByTestId("permission-row-use").getByRole("button", { name: "Revoke" }).click();
    await expect.poll(() => revokeRequests.length).toBe(1);
    expect(revokeRequests[0]).toMatchObject({
      resource: { type: "agent", id: "agent-private" },
      grantee: { type: "user", id: "user-123" },
      capability: "use",
    });
    await expect(page.getByTestId("permission-row-use")).toContainText("DENY");
  });

  test("audit log expands policy details and downloads the filtered JSON payload", async ({
    page,
  }) => {
    const records = auditRecords();
    const auditQueries: string[] = [];

    const auditHandler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path !== "/api/admin/audit-events" || method !== "GET") {
        return false;
      }

      auditQueries.push(url.search);
      const typeFilter = url.searchParams.get("type");
      const filtered = typeFilter
        ? records.filter((record) => record.type === typeFilter)
        : records;

      await fulfillJson(route, {
        records: filtered,
        total: filtered.length,
        page: Number(url.searchParams.get("page") ?? "1"),
        limit: Number(url.searchParams.get("limit") ?? "30"),
      });
      return true;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [auditHandler],
    });

    await page.goto("/admin?cat=security&tab=action-audit", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("RBAC Audit Log", { exact: true })).toBeVisible();
    await expect(page.getByText("2 events found")).toBeVisible();
    await expect(page.getByText("Granted use on agent agent-private")).toBeVisible();
    await expect(page.getByText("Denied to manage agent agent-private")).toBeVisible();

    await page.getByText("Granted use on agent agent-private").click();
    await expect(page.getByText(/Grantee:\s*user:\*/)).toBeVisible();
    await expect(page.getByText(/Correlation ID:\s*corr-grant/)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /download audit log/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^rbac-audit-log-.*\.json$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const payload = JSON.parse(await readFile(downloadPath!, "utf8"));
    expect(payload.record_count).toBe(2);
    expect(payload.records[0].correlation_id).toBe("corr-grant");

    await page.locator("select").first().selectOption("cas_grant");
    await page.getByRole("button", { name: /^Search$/ }).click();

    await expect.poll(() => auditQueries.some((query) => query.includes("type=cas_grant"))).toBe(true);
    await expect(page.getByText("1 event found")).toBeVisible();
    await expect(page.getByText("Denied to manage agent agent-private")).toHaveCount(0);
  });
});
