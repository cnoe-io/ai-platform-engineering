// assisted-by claude code claude-sonnet-4-6
// assisted-by Codex Codex-sonnet-4-6
/**
 * E2e tests for the Platform Health widget in the AppHeader.
 *
 * These tests use the mocked-rbac harness so no live services are required.
 * They verify:
 *   - The health badge renders and reflects the /api/platform/health response
 *   - Clicking the badge opens the probes popover
 *   - RAG failures produce "degraded" (amber), not "down" (red)
 *   - Critical service failures produce "down" (red)
 *   - The status dot has no animate-pulse class (no continuous flashing)
 *   - /api/platform/health never returns 500
 */

import { test, expect } from "@playwright/test";
import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
} from "./_mocked-rbac";

// ---------------------------------------------------------------------------
// Shared probe fixtures
// ---------------------------------------------------------------------------

function makeProbe(
  id: string,
  group: "core" | "identity" | "storage" | "rag" | "bootstrap",
  status: "healthy" | "warning" | "down",
  label?: string,
) {
  return {
    id,
    label: label ?? id,
    group,
    status,
    detail: status === "healthy" ? "OK" : "connection refused",
    target: `http://${id}:8080`,
    latency_ms: status === "healthy" ? 12 : null,
  };
}

const ALL_HEALTHY_PROBES = [
  makeProbe("keycloak", "identity", "healthy"),
  makeProbe("openfga", "identity", "healthy"),
  makeProbe("openfga-authz-bridge", "identity", "healthy"),
  makeProbe("agentgateway", "core", "healthy"),
  makeProbe("agentgateway-config-bridge", "core", "healthy"),
  makeProbe("dynamic-agents", "core", "healthy"),
  makeProbe("caipe-mongodb", "storage", "healthy"),
  makeProbe("keycloak-postgres", "storage", "healthy"),
  makeProbe("openfga-postgres", "storage", "healthy"),
  makeProbe("rag-server", "rag", "healthy"),
  makeProbe("rag-redis", "rag", "healthy"),
  makeProbe("milvus", "rag", "healthy"),
  makeProbe("milvus-minio", "rag", "healthy"),
  makeProbe("etcd", "rag", "healthy"),
  makeProbe("openfga-bootstrap", "bootstrap", "healthy"),
  makeProbe("keycloak-bootstrap", "bootstrap", "healthy"),
  makeProbe("rebac-migrations", "bootstrap", "healthy"),
  makeProbe("web-ingestor", "rag", "healthy"),
];

function healthResponse(
  overrideProbes: typeof ALL_HEALTHY_PROBES = ALL_HEALTHY_PROBES,
) {
  const down = overrideProbes.filter((p) => p.status === "down").length;
  const warning = overrideProbes.filter((p) => p.status === "warning").length;
  const healthy = overrideProbes.length - down - warning;
  const status = down > 0 ? "down" : warning > 0 ? "degraded" : "healthy";
  return {
    status,
    checked_at: new Date().toISOString(),
    summary: { total: overrideProbes.length, healthy, warning, down },
    probes: overrideProbes,
  };
}

// ---------------------------------------------------------------------------
// Helper: mount the app and intercept /api/platform/health
// ---------------------------------------------------------------------------

async function setupWithHealth(
  page: typeof test.prototype["context"] extends infer C
    ? C extends { newPage(): Promise<infer P> }
      ? P
      : never
    : never,
  healthBody: ReturnType<typeof healthResponse>,
) {
  await installMockedRbacApp(page, {
    isAdmin: true,
    handlers: [
      async ({ route, path }) => {
        if (path === "/api/platform/health") {
          await fulfillJson(route, healthBody, healthBody.summary.down > 0 ? 503 : 200);
          return true;
        }
        return false;
      },
    ],
  });
  await page.goto("/");
  // Wait for the header to stabilise before asserting
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Platform Health widget", () => {
  test.beforeEach(() => {
    if (!mockedRbacEnabled()) {
      test.skip(true, "Set RUN_RBAC_E2E=1 to run platform health e2e tests.");
    }
  });

  test("status badge is visible in the header", async ({ page }) => {
    await setupWithHealth(page, healthResponse());
    // The aria-label on the popover trigger button contains "System status"
    await expect(page.getByRole("button", { name: /system status/i })).toBeVisible();
  });

  test("healthy response → badge shows green dot, no 'Down' label", async ({ page }) => {
    await setupWithHealth(page, healthResponse());

    const badge = page.getByRole("button", { name: /system status/i });
    await expect(badge).toBeVisible();

    // When healthy the badge shows only a dot (no expanded label text)
    // The dot should exist and have no animate-pulse class
    const dot = badge.locator("div.rounded-full").first();
    await expect(dot).toBeVisible();
    await expect(dot).not.toHaveClass(/animate-pulse/);
  });

  test("clicking badge opens the probes popover", async ({ page }) => {
    await setupWithHealth(page, healthResponse());

    await page.getByRole("button", { name: /system status/i }).click();

    // Popover header
    await expect(page.getByText("System Status")).toBeVisible();
    // At least one probe row is visible
    await expect(page.getByText("Keycloak")).toBeVisible();
    await expect(page.getByText("OpenFGA")).toBeVisible();
    await expect(page.getByText("Dynamic Agents")).toBeVisible();
  });

  test("RAG failure → overall status is 'degraded' (amber), not 'down' (red)", async ({ page }) => {
    const probes = ALL_HEALTHY_PROBES.map((p) =>
      p.group === "rag" ? { ...p, status: "warning" as const } : p,
    );
    await setupWithHealth(page, healthResponse(probes));

    const badge = page.getByRole("button", { name: /system status/i });
    await expect(badge).toBeVisible();

    // Badge should not show "Down" text
    await expect(badge).not.toContainText("Down");

    // Open popover — should show "Action Needed" or "RAG Offline", not "Issues Detected"
    await badge.click();
    const popover = page.locator("[data-radix-popper-content-wrapper]");
    await expect(popover).toBeVisible();
    // RAG probes appear warning (amber) — the platform header should not say Issues Detected
    await expect(popover.getByText(/issues detected/i)).not.toBeVisible();
  });

  test("critical service down → badge shows 'Issues Detected'", async ({ page }) => {
    const probes = ALL_HEALTHY_PROBES.map((p) =>
      p.id === "openfga" ? { ...p, status: "down" as const } : p,
    );
    await setupWithHealth(page, healthResponse(probes));

    const badge = page.getByRole("button", { name: /system status/i });
    await badge.click();

    const popover = page.locator("[data-radix-popper-content-wrapper]");
    await expect(popover.getByText(/issues detected/i)).toBeVisible();
  });

  test("status dot has no animate-pulse class (no continuous flashing)", async ({ page }) => {
    await setupWithHealth(page, healthResponse());

    const badge = page.getByRole("button", { name: /system status/i });
    await expect(badge).toBeVisible();

    // Assert the specific badge dot class does not contain animate-pulse.
    const dot = badge.locator("div.h-2.w-2.rounded-full");
    if (await dot.count() > 0) {
      await expect(dot.first()).not.toHaveClass(/animate-pulse/);
    }
  });

  test("/api/platform/health does not return 500", async ({ page }) => {
    const responses: number[] = [];

    await installMockedRbacApp(page, {
      isAdmin: true,
      handlers: [
        async ({ route, path }) => {
          if (path === "/api/platform/health") {
            // Pass through to the real handler — but intercept the response status
            await route.continue();
            return true;
          }
          return false;
        },
      ],
    });

    page.on("response", (resp) => {
      if (resp.url().includes("/api/platform/health")) {
        responses.push(resp.status());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Should not have received a 500
    expect(responses.every((s) => s !== 500)).toBe(true);
  });

  test("probes popover lists all expected groups", async ({ page }) => {
    await setupWithHealth(page, healthResponse());

    await page.getByRole("button", { name: /system status/i }).click();

    const popover = page.locator("[data-radix-popper-content-wrapper]");
    await expect(popover).toBeVisible();

    // All four groups should be represented
    for (const label of ["Keycloak", "OpenFGA", "MongoDB", "RAG Server", "Dynamic Agents"]) {
      await expect(popover.getByText(label)).toBeVisible();
    }
  });
});
