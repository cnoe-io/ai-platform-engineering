import { test, expect, type Page } from "@playwright/test";
import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
} from "./_mocked-rbac";
import { dismissReleaseUpgradeDialog } from "./_helpers";

type CapabilityStatus = "healthy" | "degraded" | "down" | "disabled";

type Capability = {
  id: string;
  label: string;
  group: "runtime" | "knowledge" | "identity" | "observability" | "messaging";
  status: CapabilityStatus;
  required: boolean;
  description: string;
  detail: string;
  latency_ms: number | null;
};

const HEALTHY_CAPABILITIES: Capability[] = [
  {
    id: "chat-runtime",
    label: "Chat Runtime",
    group: "runtime",
    status: "healthy",
    required: true,
    description: "Checks the supervisor health endpoint used by the chat experience.",
    detail: "Supervisor reachable",
    latency_ms: 12,
  },
  {
    id: "dynamic-agents",
    label: "Dynamic Agents",
    group: "runtime",
    status: "healthy",
    required: true,
    description: "Checks Dynamic Agents when custom agent runtime is enabled.",
    detail: "Runtime reachable",
    latency_ms: 14,
  },
  {
    id: "knowledge-bases",
    label: "Knowledge Bases",
    group: "knowledge",
    status: "healthy",
    required: false,
    description: "Checks the RAG API used by Knowledge Bases.",
    detail: "RAG API reachable",
    latency_ms: 18,
  },
  {
    id: "authentication",
    label: "Authentication",
    group: "identity",
    status: "healthy",
    required: false,
    description: "Reads the UI SSO configuration.",
    detail: "SSO enabled",
    latency_ms: null,
  },
  {
    id: "metrics",
    label: "Metrics",
    group: "observability",
    status: "disabled",
    required: false,
    description: "Reads the UI Prometheus configuration.",
    detail: "Prometheus not configured",
    latency_ms: null,
  },
];

function healthResponse(capabilities: Capability[] = HEALTHY_CAPABILITIES) {
  const healthy = capabilities.filter((capability) => capability.status === "healthy").length;
  const degraded = capabilities.filter((capability) => capability.status === "degraded").length;
  const down = capabilities.filter((capability) => capability.status === "down").length;
  const disabled = capabilities.filter((capability) => capability.status === "disabled").length;
  const requiredDown = capabilities.some(
    (capability) => capability.required && capability.status === "down",
  );

  return {
    status: requiredDown ? "down" : degraded > 0 ? "degraded" : "healthy",
    checked_at: new Date().toISOString(),
    summary: { total: capabilities.length, healthy, degraded, down, disabled },
    capabilities,
  };
}

async function setupWithHealth(page: Page, body = healthResponse()) {
  await installMockedRbacApp(page, {
    isAdmin: true,
    handlers: [
      async ({ route, path }) => {
        if (path === "/api/platform/health") {
          await fulfillJson(route, body, body.status === "down" ? 503 : 200);
          return true;
        }
        if (path === "/api/admin/metrics") {
          await fulfillJson(route, {
            success: false,
            code: "PROMETHEUS_NOT_CONFIGURED",
            error: "Prometheus not configured",
          });
          return true;
        }
        if (path === "/api/rag/healthz" || path === "/api/rag/health") {
          await fulfillJson(route, {
            status: "healthy",
            config: {
              graph_rag_enabled: false,
              cleanup: {
                enabled: true,
                interval_seconds: 86400,
                last_cleanup: null,
              },
            },
          });
          return true;
        }
        return false;
      },
    ],
  });
  await page.goto("/");
  await dismissReleaseUpgradeDialog(page);
  await page.waitForLoadState("networkidle");
}

async function openHealthPopover(page: Page, statusPattern: RegExp = /system status: connected/i) {
  await dismissReleaseUpgradeDialog(page);
  const badge = page.getByRole("button", { name: statusPattern });
  await expect(badge).toBeVisible();
  await badge.click({ force: true });
  await expect(page.getByText("System Status")).toBeVisible();
}

test.describe("Platform Health widget", () => {
  test.beforeEach(() => {
    if (!mockedRbacEnabled()) {
      test.skip(true, "Set RUN_RBAC_E2E=1 to run platform health e2e tests.");
    }
  });

  test("healthy response keeps the header compact", async ({ page }) => {
    await setupWithHealth(page);

    const badge = page.getByRole("button", { name: /system status: connected/i });
    await expect(badge).toBeVisible();
    await expect(badge).not.toContainText("Connected");

    await openHealthPopover(page);
    await expect(page.getByText("Platform")).toBeVisible();
    await expect(page.getByText("Chat Runtime")).toBeVisible();
    await expect(page.getByRole("button", { name: /open health dashboard/i })).toHaveCount(0);
  });

  test("optional capability failure degrades without marking the platform down", async ({ page }) => {
    const capabilities = HEALTHY_CAPABILITIES.map((capability) =>
      capability.id === "knowledge-bases"
        ? {
            ...capability,
            status: "degraded" as const,
            detail: "Knowledge Bases health check returned HTTP 503",
          }
        : capability,
    );
    await setupWithHealth(page, healthResponse(capabilities));

    await expect(page.getByRole("button", { name: /system status: degraded/i })).toBeVisible();
    await openHealthPopover(page, /system status: degraded/i);
    await expect(page.getByText("Degraded")).toBeVisible();
    await expect(page.getByText("Knowledge Bases")).toBeVisible();
    await expect(page.getByText("Knowledge Bases health check returned HTTP 503")).toBeVisible();
    await expect(page.getByText(/need attention/i)).toHaveCount(0);
  });

  test("required chat runtime failure marks the platform down", async ({ page }) => {
    const capabilities = HEALTHY_CAPABILITIES.map((capability) =>
      capability.id === "chat-runtime"
        ? {
            ...capability,
            status: "down" as const,
            detail: "Supervisor health check returned HTTP 503",
          }
        : capability,
    );
    await setupWithHealth(page, healthResponse(capabilities));

    await expect(page.getByRole("button", { name: /system status: disconnected/i })).toBeVisible();
    await openHealthPopover(page, /system status: disconnected/i);
    await expect(page.getByText("Down")).toBeVisible();
    await expect(page.getByText("Chat Runtime")).toBeVisible();
    await expect(page.getByText("Supervisor health check returned HTTP 503")).toBeVisible();
  });

  test("admin Health tab shows capabilities, not integration diagnostics", async ({ page }) => {
    await setupWithHealth(page);

    await page.goto("/admin?cat=platform&tab=health");
    await dismissReleaseUpgradeDialog(page);

    await expect(page.getByRole("tab", { name: "Health", selected: true })).toBeVisible();
    await expect(page.getByText("Platform Capabilities")).toBeVisible();
    await expect(page.getByText("Chat Runtime")).toBeVisible();
    await expect(page.getByText("Checks the supervisor health endpoint used by the chat experience.")).toBeVisible();
    await expect(page.getByText("Slack Integration")).toHaveCount(0);
    await expect(page.getByText("Webex Integration")).toHaveCount(0);
    await expect(page.getByText("All dependency checks are passing.")).toHaveCount(0);
  });
});
