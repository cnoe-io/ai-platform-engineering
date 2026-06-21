import { expect, test } from "@playwright/test";

import { installMockedRbacApp, mockedRbacEnabled } from "./_mocked-rbac";

const BASE_URL = process.env.E2E_UI_URL ?? "http://localhost:3000";

test.describe("audit log — mocked regression", () => {
  test.beforeEach(() => {
    test.skip(!mockedRbacEnabled(), "Set RUN_RBAC_REGRESSION=1");
  });

  test("sign-in flow completes normally regardless of audit backend", async ({ page }) => {
    const auditErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().toLowerCase().includes("audit")) {
        auditErrors.push(msg.text());
      }
    });

    await installMockedRbacApp(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page).not.toHaveURL(/error/);
    expect(auditErrors).toHaveLength(0);
  });

  test("admin page renders without audit errors", async ({ page }) => {
    const auditErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().toLowerCase().includes("audit")) {
        auditErrors.push(msg.text());
      }
    });

    await installMockedRbacApp(page, { isAdmin: true });
    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    await expect(page).not.toHaveURL(/error/);
    expect(auditErrors).toHaveLength(0);
  });

  test("audit write errors do not surface as UI errors", async ({ page }) => {
    const auditErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().toLowerCase().includes("audit")) {
        auditErrors.push(msg.text());
      }
    });

    await installMockedRbacApp(page, {
      handlers: [
        async ({ route, path, method }) => {
          if (path === "/api/authz/check" && method === "POST") {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ allowed: true }),
            });
            return true;
          }
          return false;
        },
      ],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const errorBanner = page.getByRole("alert").filter({ hasText: /error/i });
    await expect(errorBanner).toHaveCount(0);
    expect(auditErrors).toHaveLength(0);
  });

  test("protected route access does not stall waiting for audit write", async ({ page }) => {
    await installMockedRbacApp(page);

    const start = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});

test.describe("audit log — live audit-service e2e", () => {
  test.beforeEach(() => {
    test.skip(
      process.env.RUN_RBAC_E2E !== "1" || process.env.AUDIT_TEST_MODE !== "1",
      "Set RUN_RBAC_E2E=1 and AUDIT_TEST_MODE=1",
    );
  });

  test("drain endpoint is reachable and returns events array", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/_test/audit`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("events");
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("written events are readable via drain endpoint", async ({ request }) => {
    const ts = new Date().toISOString();
    const tenantId = `playwright-tenant-${Date.now()}`;
    const testEvent = {
      ts,
      type: "auth",
      action: "sign_in",
      outcome: "allow",
      tenant_id: tenantId,
    };

    const postRes = await request.post(`${BASE_URL}/api/_test/audit`, { data: testEvent });
    expect(postRes.status()).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const getRes = await request.get(`${BASE_URL}/api/_test/audit`);
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    expect(body.events.length).toBeGreaterThanOrEqual(1);

    const found = body.events.find(
      (e: Record<string, unknown>) =>
        e.type === testEvent.type &&
        e.action === testEvent.action &&
        e.outcome === testEvent.outcome &&
        e.tenant_id === tenantId,
    );
    expect(found).toBeDefined();
  });

  test("multiple event types are written", async ({ request }) => {
    const ts = new Date().toISOString();
    const tenantId = `t1-${Date.now()}`;
    await request.post(`${BASE_URL}/api/_test/audit`, {
      data: { ts, type: "auth", action: "sign_in", outcome: "allow", tenant_id: tenantId },
    });
    await request.post(`${BASE_URL}/api/_test/audit`, {
      data: {
        ts,
        type: "credential_action",
        action: "create",
        outcome: "success",
        tenant_id: tenantId,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const res = await request.get(`${BASE_URL}/api/_test/audit`);
    const body = await res.json();

    const types = body.events
      .filter((e: Record<string, unknown>) => e.tenant_id === tenantId)
      .map((e: Record<string, unknown>) => e.type);
    expect(types).toContain("auth");
    expect(types).toContain("credential_action");
  });

  test("event timestamp is preserved", async ({ request }) => {
    const ts = new Date().toISOString();
    const tenantId = `t1-${Date.now()}`;
    await request.post(`${BASE_URL}/api/_test/audit`, {
      data: { ts, type: "auth", action: "check", outcome: "allow", tenant_id: tenantId },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const res = await request.get(`${BASE_URL}/api/_test/audit`);
    const body = await res.json();

    const found = body.events.find(
      (e: Record<string, unknown>) => e.ts === ts && e.tenant_id === tenantId,
    );
    expect(found).toBeDefined();
    expect(found.ts).toBe(ts);
  });

  test("write errors do not cause 500 on drain endpoint", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/_test/audit`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("events");
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("concurrent writes do not corrupt the log", async ({ request }) => {
    const ts = new Date().toISOString();
    const action = `concurrent_check_${Date.now()}`;
    const writes = Array.from({ length: 10 }, (_, i) =>
      request.post(`${BASE_URL}/api/_test/audit`, {
        data: {
          ts,
          type: "auth",
          action,
          outcome: "allow",
          tenant_id: `tenant-${i}`,
          index: i,
        },
      }),
    );

    await Promise.all(writes);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const res = await request.get(`${BASE_URL}/api/_test/audit`);
    const body = await res.json();

    const concurrentEvents = body.events.filter(
      (e: Record<string, unknown>) => e.action === action,
    );
    expect(concurrentEvents).toHaveLength(10);
  });

  test("drain endpoint correctly filters to today's events", async ({ request }) => {
    const ts = new Date().toISOString();
    const action = `today_check_${Date.now()}`;
    await request.post(`${BASE_URL}/api/_test/audit`, {
      data: { ts, type: "auth", action, outcome: "allow", tenant_id: "t1" },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const res = await request.get(`${BASE_URL}/api/_test/audit`);
    const body = await res.json();

    const found = body.events.find(
      (e: Record<string, unknown>) => e.action === action,
    );
    expect(found).toBeDefined();
  });
});
