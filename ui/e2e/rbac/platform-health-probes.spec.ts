import { expect, Page, test } from "@playwright/test";
import { rbacEnvOrSkip, type RbacEnv } from "./_env";
import { dismissReleaseUpgradeDialog, installTestSession } from "./_helpers";

type ProbeStatus = "healthy" | "warning" | "down";

type Probe = {
  id: string;
  label: string;
  group: "core" | "identity" | "storage" | "rag" | "bootstrap";
  status: ProbeStatus;
  detail: string;
  target: string;
  latency_ms: number;
  remediation?: {
    label: string;
    href: string;
    description: string;
  };
};

function platformHealthPayload(probes: Probe[]) {
  const down = probes.filter((probe) => probe.status === "down").length;
  const warning = probes.filter((probe) => probe.status === "warning").length;
  return {
    status: down > 0 ? "down" : warning > 0 ? "degraded" : "healthy",
    checked_at: new Date("2026-06-18T12:00:00Z").toISOString(),
    summary: {
      total: probes.length,
      healthy: probes.length - down - warning,
      warning,
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
  {
    id: "openfga-bootstrap",
    label: "OpenFGA Bootstrap",
    group: "bootstrap",
    status: "healthy",
    detail: "Store and model ready",
    target: "http://openfga:8080/stores/caipe/authorization-models",
    latency_ms: 16,
  },
  {
    id: "keycloak-bootstrap",
    label: "Keycloak Bootstrap",
    group: "bootstrap",
    status: "healthy",
    detail: "Realm and clients ready",
    target: "caipe realm",
    latency_ms: 13,
  },
  {
    id: "rbac-migrations",
    label: "RBAC Migrations",
    group: "bootstrap",
    status: "healthy",
    detail: "Schema migrations current",
    target: "0.5.16",
    latency_ms: 9,
  },
  {
    id: "mongodb",
    label: "MongoDB",
    group: "storage",
    status: "healthy",
    detail: "TCP connection accepted",
    target: "caipe-mongodb:27017",
    latency_ms: 3,
  },
  {
    id: "keycloak-postgres",
    label: "Keycloak Postgres",
    group: "storage",
    status: "healthy",
    detail: "TCP connection accepted",
    target: "keycloak-postgres:5432",
    latency_ms: 4,
  },
  {
    id: "openfga-postgres",
    label: "OpenFGA Postgres",
    group: "storage",
    status: "healthy",
    detail: "TCP connection accepted",
    target: "openfga-postgres:5432",
    latency_ms: 4,
  },
  {
    id: "rag-server",
    label: "RAG Server",
    group: "rag",
    status: "healthy",
    detail: "HTTP 200",
    target: "http://caipe-rag-server:9446/healthz",
    latency_ms: 24,
  },
  {
    id: "web-ingestor",
    label: "Web Ingestor",
    group: "rag",
    status: "healthy",
    detail: "Queue ready",
    target: "web-ingestor",
    latency_ms: 6,
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

  await page.route("**/api/admin/platform-config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          default_agent_id: null,
          release_notes: { enabled: false },
        },
      }),
    });
  });

  await installTestSession(page, env, {
    email: env.user.email,
    subject: env.user.sub,
    role: "admin",
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissReleaseUpgradeDialog(page);
}

async function openSystemStatus(page: Page) {
  await dismissReleaseUpgradeDialog(page);
  const trigger = page.getByRole("button", { name: /system status:/i });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await dismissReleaseUpgradeDialog(page);
  await trigger.click({ force: true });
}

async function expectGroupTooltip(page: Page, label: string, expectedProbe: string, expectedTarget: string) {
  const group = page.getByText(label, { exact: true });
  await expect(group).toBeVisible();
  await group.hover();
  await expect(page.getByText(expectedProbe, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(expectedTarget, { exact: true }).first()).toBeVisible();
  await page.mouse.move(0, 0);
}

function manyHealthyProbes(count: number): Probe[] {
  return Array.from({ length: count }, (_, index) => {
    const base = healthyProbes[index % healthyProbes.length];
    return {
      ...base,
      id: `${base.id}-${index}`,
      label: `${base.label} ${index + 1}`,
      target: `${base.target}?probe=${index + 1}`,
    };
  });
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
    await expect(page.getByText("13/13")).toBeVisible();
    const dynamicAgentRuntime = page.getByText("Dynamic Agent Runtime", { exact: true });
    await expect(dynamicAgentRuntime).toBeVisible();
    await expect(page.getByText("Identity & Authz")).toBeVisible();
    await expect(page.getByText("All critical checks are ready.")).toBeVisible();

    await dynamicAgentRuntime.hover();
    await expect(page.getByText("AgentGateway Config Bridge")).toBeVisible();
    await expect(page.getByText("http://caipe-ui:3000/api/internal/agentgateway/mcp-targets")).toBeVisible();
  });

  test("every health group tooltip lists the probes and targets behind the rollup", async ({ page }) => {
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
    await openSystemStatus(page);

    await expectGroupTooltip(
      page,
      "Dynamic Agent Runtime",
      "AgentGateway Config Bridge",
      "http://caipe-ui:3000/api/internal/agentgateway/mcp-targets",
    );
    await expectGroupTooltip(
      page,
      "Identity & Authz",
      "Keycloak",
      "http://keycloak:7080/realms/caipe/protocol/openid-connect/certs",
    );
    await expectGroupTooltip(
      page,
      "Bootstrap & Migrations",
      "RBAC Migrations",
      "0.5.16",
    );
    await expectGroupTooltip(
      page,
      "Storage",
      "MongoDB",
      "caipe-mongodb:27017",
    );
    await expectGroupTooltip(
      page,
      "RAG & Web Ingestor",
      "Web Ingestor",
      "web-ingestor",
    );
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
    await expect(page.getByText("12/13")).toBeVisible();
    await expect(page.getByText("Action needed")).toBeVisible();
    await expect(page.getByText("OpenFGA", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("HTTP 503").first()).toBeVisible();
    await expect(page.getByText("Down").first()).toBeVisible();
    await expect(page.getByText("Check logs for details")).toBeVisible();
  });

  test("down probes render as red outages, not amber warnings", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    await installStableHeaderHealthMocks(page);
    const probes = healthyProbes.map((probe) =>
      probe.id === "agentgateway"
        ? { ...probe, status: "down" as const, detail: "connection refused", latency_ms: 31 }
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

    const statusButton = page.getByRole("button", { name: /system status: disconnected/i });
    await expect(statusButton).toBeVisible();
    await expect(statusButton).toHaveClass(/red/);
    await openSystemStatus(page);

    await expect(page.getByText("Issues Detected")).toBeVisible();
    await expect(page.getByText("12/13 Down")).toBeVisible();
    await expect(page.getByText("Check logs for details")).toBeVisible();
    await expect(page.getByText("Needs Attention")).toHaveCount(0);
    await expect(page.getByText("AgentGateway", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("connection refused").first()).toBeVisible();
    await expect(page.getByText("Down").first()).toBeVisible();
  });

  test("warning probes render as amber degraded state without marking the stack down", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    await installStableHeaderHealthMocks(page);
    const probes = healthyProbes.map((probe) =>
      probe.id === "rbac-migrations"
        ? {
            ...probe,
            status: "warning" as const,
            detail: "2 blocking migrations pending",
            latency_ms: 0,
            remediation: {
              label: "Migration Assistant",
              href: "/admin?cat=security&tab=migrations",
              description: "Open the migration assistant to apply required schema migrations.",
            },
          }
        : probe,
    );
    await page.route("**/api/platform/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(platformHealthPayload(probes)),
      });
    });

    await installSessionAndOpenHome(page, env);

    const statusButton = page.getByRole("button", { name: /system status: needs attention/i });
    await expect(statusButton).toBeVisible();
    await expect(statusButton).toHaveClass(/amber/);
    await expect(page.getByRole("button", { name: /system status: disconnected/i })).toHaveCount(0);
    await openSystemStatus(page);

    await expect(page.getByText("Action Needed", { exact: true })).toBeVisible();
    await expect(page.getByText("12/13 Attention")).toBeVisible();
    await expect(page.getByText("Action available")).toBeVisible();
    await expect(page.getByText("Issues Detected")).toHaveCount(0);
    await expect(page.getByText("RBAC Migrations").first()).toBeVisible();
    await expect(page.getByText("2 blocking migrations pending").first()).toBeVisible();
    await expect(page.getByText("Check").first()).toBeVisible();
    await page.getByText("Bootstrap & Migrations", { exact: true }).hover();
    await expect(page.getByText("1 of 3 need attention")).toBeVisible();
  });

  test("remediation buttons navigate to the configured admin surface", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    await installStableHeaderHealthMocks(page);
    const probes = healthyProbes.map((probe) =>
      probe.id === "openfga"
        ? {
            ...probe,
            status: "down" as const,
            detail: "HTTP 503",
            latency_ms: 31,
            remediation: {
              label: "OpenFGA",
              href: "/admin?cat=security&tab=openfga",
              description: "Open the OpenFGA diagnostics tab.",
            },
          }
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
    await openSystemStatus(page);

    await page.locator('button[title="Open the OpenFGA diagnostics tab."]').click();
    await expect(page).toHaveURL(/\/admin\?cat=security&tab=openfga/);
  });

  test("long probe output scrolls inside the status popover", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    await installStableHeaderHealthMocks(page);
    await page.route("**/api/platform/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(platformHealthPayload(manyHealthyProbes(40))),
      });
    });

    await installSessionAndOpenHome(page, env);
    await openSystemStatus(page);

    const popoverScroller = page.getByTestId("platform-health-scroll");
    const probeList = page.getByTestId("platform-health-probe-list");
    await expect(probeList).toBeVisible();
    await expect(probeList).toHaveJSProperty("scrollTop", 0);
    await expect
      .poll(async () =>
        probeList.evaluate((node) => node.scrollHeight > node.clientHeight),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        popoverScroller.evaluate((node) => node.scrollHeight <= node.clientHeight || getComputedStyle(node).overflowY === "auto"),
      )
      .toBe(true);

    await probeList.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(async () => probeList.evaluate((node) => node.scrollTop > 0))
      .toBe(true);
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
