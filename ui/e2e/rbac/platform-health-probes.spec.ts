import { expect, Page, test } from "@playwright/test";
import { rbacEnvOrSkip, type RbacEnv } from "./_env";
import { dismissReleaseUpgradeDialog, installTestSession } from "./_helpers";

type ProbeStatus = "healthy" | "down";

type Probe = {
  id: string;
  label: string;
  group: "core" | "identity" | "storage" | "rag" | "bootstrap";
  status: ProbeStatus;
  detail: string;
  target: string;
  latency_ms: number;
};

function platformHealthPayload(probes: Probe[]) {
  const down = probes.filter((probe) => probe.status === "down").length;
  return {
    status: down > 0 ? "down" : "healthy",
    checked_at: new Date("2026-06-18T12:00:00Z").toISOString(),
    summary: {
      total: probes.length,
      healthy: probes.length - down,
      warning: 0,
      down,
    },
    probes,
  };
}

const healthyProbes: Probe[] = [
  {
    id: "keycloak",
    label: "Keycloak",
    group: "identity",
    status: "healthy",
    detail: "HTTP 200",
    target: "http://keycloak:7080/realms/caipe/protocol/openid-connect/certs",
    latency_ms: 10,
  },
  {
    id: "openfga",
    label: "OpenFGA",
    group: "identity",
    status: "healthy",
    detail: "HTTP 200",
    target: "http://openfga:8080/healthz",
    latency_ms: 11,
  },
  {
    id: "openfga-authz-bridge",
    label: "OpenFGA Bridge",
    group: "identity",
    status: "healthy",
    detail: "TCP connection accepted",
    target: "openfga-authz-bridge:9100",
    latency_ms: 2,
  },
  {
    id: "agentgateway-config-bridge",
    label: "AgentGateway Config Bridge",
    group: "core",
    status: "healthy",
    detail: "HTTP 200",
    target: "http://caipe-ui:3000/api/internal/agentgateway/mcp-targets",
    latency_ms: 18,
  },
  {
    id: "agentgateway",
    label: "AgentGateway",
    group: "core",
    status: "healthy",
    detail: "HTTP 200",
    target: "http://agentgateway:15000/config",
    latency_ms: 7,
  },
];

async function installStableHeaderHealthMocks(page: Page): Promise<void> {
  await page.route("**/.well-known/agent-card.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "AI Platform Engineer",
        description: "Central orchestrator",
        skills: [],
      }),
    });
  });

  await page.route("**/api/rag/healthz", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "healthy",
        config: {
          graph_rag_enabled: false,
          cleanup: {
            enabled: true,
            interval_seconds: 86400,
            last_cleanup: null,
          },
        },
      }),
    });
  });

  await page.route("**/api/dynamic-agents/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "healthy" }),
    });
  });
}

async function installSessionAndOpenHome(page: Page, env: RbacEnv): Promise<void> {
  test.skip(!process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET is required for deterministic local session e2e.");
  test.skip(!env.user.sub, "RBAC_USER_SUB is required for deterministic local session e2e.");

  await installTestSession(page, env, {
    email: env.user.email,
    subject: env.user.sub,
    role: "admin",
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissReleaseUpgradeDialog(page);
}

async function openSystemStatus(page: Page) {
  const trigger = page.getByRole("button", { name: /system status:/i });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
}

test.describe("platform health probes", () => {
  test("healthy probes replace connected integrations in the status popover", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    await installStableHeaderHealthMocks(page);
    await page.route("**/api/platform/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(platformHealthPayload(healthyProbes)),
      });
    });

    await installSessionAndOpenHome(page, env);

    await expect(page.getByRole("button", { name: /system status: connected/i })).toBeVisible();
    await openSystemStatus(page);

    await expect(page.getByText("Platform Health")).toBeVisible();
    await expect(page.getByText("Connected Integrations")).toHaveCount(0);
    await expect(page.getByText("5/5")).toBeVisible();
    await expect(page.getByText("Core Runtime", { exact: true })).toBeVisible();
    await expect(page.getByText("Identity & Authz")).toBeVisible();
    await expect(page.getByText("Core runtime, identity, storage, RAG, web ingestor queue readiness, and migrations look ready.")).toBeVisible();
  });

  test("a down platform dependency changes the header to issues detected", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    await installStableHeaderHealthMocks(page);
    const probes = healthyProbes.map((probe) =>
      probe.id === "openfga"
        ? { ...probe, status: "down" as const, detail: "HTTP 503", latency_ms: 31 }
        : probe,
    );
    await page.route("**/api/platform/health", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify(platformHealthPayload(probes)),
      });
    });

    await installSessionAndOpenHome(page, env);

    await expect(page.getByRole("button", { name: /system status: disconnected/i })).toBeVisible();
    await openSystemStatus(page);

    await expect(page.getByText("Issues Detected")).toBeVisible();
    await expect(page.getByText("4/5")).toBeVisible();
    await expect(page.getByText("Action needed")).toBeVisible();
    await expect(page.getByText("OpenFGA", { exact: true })).toBeVisible();
    await expect(page.getByText("HTTP 503")).toBeVisible();
    await expect(page.getByText("DOWN").first()).toBeVisible();
    await expect(page.getByText("Check logs for details")).toBeVisible();
  });

  test("pending probe results show an explicit checking state", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    await installStableHeaderHealthMocks(page);

    let releasePlatformHealth!: () => void;
    const platformHealthCanReturn = new Promise<void>((resolve) => {
      releasePlatformHealth = resolve;
    });

    await page.route("**/api/platform/health", async (route) => {
      await platformHealthCanReturn;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(platformHealthPayload(healthyProbes)),
      });
    });

    await installSessionAndOpenHome(page, env);

    await expect(page.getByRole("button", { name: /system status: checking/i })).toBeVisible();
    await openSystemStatus(page);
    await expect(page.getByText("Checking Keycloak, OpenFGA, AgentGateway, RAG, storage, web ingestor readiness, and migrations...")).toBeVisible();

    releasePlatformHealth();
    await expect(page.getByRole("button", { name: /system status: connected/i })).toBeVisible();
  });
});
