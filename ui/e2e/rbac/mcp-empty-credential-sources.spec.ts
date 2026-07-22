// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Page } from "@playwright/test";

import { rbacEnvOrSkip } from "./_env";
import { dismissReleaseUpgradeDialog, installTestSession } from "./_helpers";
import {
  DEFAULT_JIRA_MCP_SERVER,
  gotoMcpServersTab,
  installMcpBrowserMocks,
  JIRA_MCP_UPSTREAM_ONLY_SERVER,
  openMcpServerEditor,
  openMcpTestModal,
  selectMcpTestTool,
  waitForMcpTestToolsLoaded,
  type TestToolResponseBody,
} from "./_mcp-browser-fixtures";
import { mockedRbacEnabled } from "./_mocked-rbac";

const JIRA_WITH_PROVIDER_CREDENTIALS = {
  ...DEFAULT_JIRA_MCP_SERVER,
  _id: "jira",
  name: "Jira",
};

type ApiResult = {
  status: number;
  body: unknown;
};

type BridgeTargetsBody = {
  targets?: Array<{
    id: string;
    target_endpoint: string;
    credential_sources?: unknown[];
  }>;
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

async function fetchBridgeTargets(page: Page, token: string): Promise<ApiResult> {
  return fetchJson(page, "/api/internal/agentgateway/mcp-targets", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function bridgeTarget(
  body: unknown,
  serverId: string,
): BridgeTargetsBody["targets"][number] | undefined {
  const targets = (body as BridgeTargetsBody).targets ?? [];
  return targets.find((target) => target.id === serverId);
}

async function bestEffortDeleteMcpServer(page: Page, serverId: string): Promise<void> {
  await fetchJson(page, `/api/mcp-servers?id=${encodeURIComponent(serverId)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

async function installLiveSession(
  page: Page,
  env: ReturnType<typeof rbacEnvOrSkip>,
): Promise<void> {
  await page.context().clearCookies();
  await installTestSession(page, env, {
    email: env.user.email,
    subject: env.user.sub!,
    role: "admin",
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const session = await fetchJson(page, "/api/auth/session");
  expect(session.status, JSON.stringify(session.body)).toBe(200);
}

test.describe("RBAC e2e — MCP upstream-only credentials (mocked)", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked MCP upstream-only credential regression.",
    );
  });

  test("runs the test modal without credential resolution when credential_sources is empty", async ({
    page,
  }) => {
    const mocks = await installMcpBrowserMocks(page, {
      servers: [JIRA_MCP_UPSTREAM_ONLY_SERVER],
      testToolResponder: () =>
        ({
          success: true,
          application_success: true,
          status: 200,
          result: {
            content: [{ type: "text", text: "jira-mcp 1.0.0-upstream-only" }],
          },
          credential_resolution: [],
        }) satisfies TestToolResponseBody,
    });

    await gotoMcpServersTab(page);
    await openMcpTestModal(page, "Jira MCP");
    await waitForMcpTestToolsLoaded(page);
    await page.getByRole("button", { name: "Run tool" }).click();

    await expect.poll(() => mocks.testToolRequests.length).toBe(1);
    expect(mocks.testToolRequests[0]).toMatchObject({
      serverId: "mcp-jira",
      toolName: "version",
    });
    await expect(page.getByText("Tool call succeeded")).toBeVisible();
    await expect(page.getByText("Credential resolution")).toHaveCount(0);
    await expect(page.getByText(/provider_connection/i)).toHaveCount(0);
    await expect(page.getByText(/jira-mcp 1\.0\.0-upstream-only/i)).toBeVisible();
  });

  test("shows application errors without credential resolution after credentials are cleared in the editor", async ({
    page,
  }) => {
    const mocks = await installMcpBrowserMocks(page, {
      servers: [JIRA_WITH_PROVIDER_CREDENTIALS],
      providerConnections: [
        {
          id: "conn-atlassian",
          connectorId: "atlassian-connector",
          provider: "atlassian",
          status: "connected",
        },
      ],
      oauthConnectors: [
        {
          id: "atlassian-connector",
          name: "Atlassian Cloud",
          provider: "atlassian",
        },
      ],
      testToolResponder: () =>
        ({
          success: true,
          application_success: false,
          status: 200,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "API request failed: 401 - Client must be authenticated to access this resource.",
                }),
              },
            ],
            isError: true,
          },
          credential_resolution: [],
        }) satisfies TestToolResponseBody,
    });

    await gotoMcpServersTab(page);
    await openMcpServerEditor(page, "Jira");
    await page.getByRole("button", { name: "Remove credential" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect.poll(() => mocks.updateRequests.length).toBe(1);
    expect(mocks.updateRequests[0].body.credential_sources).toEqual([]);

    await openMcpTestModal(page, "Jira");
    await waitForMcpTestToolsLoaded(page);
    await selectMcpTestTool(page, "get_current_user_account_id");
    await page.getByRole("button", { name: "Run tool" }).click();

    await expect(
      page.getByText(/MCP call succeeded, but the tool returned an application error/i),
    ).toBeVisible();
    await expect(page.getByText("Credential resolution")).toHaveCount(0);
    await expect(page.getByText(/Client must be authenticated/i)).toBeVisible();
  });

  test("creates a server without forwarding credential_sources when none are configured", async ({
    page,
  }) => {
    const mocks = await installMcpBrowserMocks(page, { servers: [] });

    await gotoMcpServersTab(page);
    await page.getByRole("button", { name: "Add Server" }).first().click();
    await page.getByLabel(/Display Name/i).fill("Upstream-only MCP");
    await page.getByRole("button", { name: /Edit generated name/i }).click();
    await page.getByLabel(/Generated name/i).fill("upstream-only");
    await page.getByLabel(/Endpoint URL/i).fill("http://mcp-jira:8000/mcp");
    await expect(page.getByRole("button", { name: /Streamable HTTP.*recommended/i })).toBeVisible();
    await page.getByRole("button", { name: "Create Server" }).click();

    await expect.poll(() => mocks.createRequests.length).toBe(1);
    expect(mocks.createRequests[0].credential_sources).toBeUndefined();
    expect(mocks.createRequests[0]).toMatchObject({
      id: "upstream-only",
      endpoint: "http://mcp-jira:8000/mcp",
    });
  });
});

test.describe("RBAC live e2e — AgentGateway bridge empty credential_sources", () => {
  test("exposes credential_sources: [] on the internal bridge targets API", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const bridgeToken = process.env.AGENTGATEWAY_TARGETS_TOKEN?.trim();
    test.skip(!bridgeToken, "AGENTGATEWAY_TARGETS_TOKEN is required for bridge contract tests.");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputId = `upstream-${suffix}`;
    const serverId = `mcp-${inputId}`;

    await installLiveSession(page, env);

    try {
      const create = await fetchJson(page, "/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: inputId,
          name: `E2E Upstream MCP ${suffix}`,
          description: "Live bridge contract fixture with cleared credentials",
          transport: "http",
          endpoint: "https://mcp-upstream.example.test/mcp",
          agentgateway_target_endpoint: "https://mcp-upstream.example.test/mcp",
          credential_sources: [],
          enabled: true,
        }),
      });
      expect(create.status, JSON.stringify(create.body)).toBe(201);
      const created = (create.body as { data?: { _id?: string; credential_sources?: unknown[] } }).data;
      expect(created?._id).toBe(serverId);
      expect(created?.credential_sources, JSON.stringify(created)).toEqual([]);

      const list = await fetchJson(page, `/api/mcp-servers?page_size=100`);
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const rows = (
        (list.body as { data?: { items?: Array<{ _id?: string; credential_sources?: unknown[] }> } })
          .data?.items ?? []
      );
      const persisted = rows.find((row) => row._id === serverId);
      expect(persisted?.credential_sources, JSON.stringify(persisted)).toEqual([]);

      const bridge = await fetchBridgeTargets(page, bridgeToken);
      expect(bridge.status, JSON.stringify(bridge.body)).toBe(200);
      const target = bridgeTarget(bridge.body, serverId);
      expect(target, JSON.stringify(bridge.body)).toMatchObject({
        id: serverId,
        target_endpoint: "https://mcp-upstream.example.test/mcp",
        credential_sources: [],
      });

      const unauthorized = await fetchBridgeTargets(page, "invalid-bridge-token");
      expect(unauthorized.status).toBe(401);
    } finally {
      await bestEffortDeleteMcpServer(page, serverId);
    }
  });

  test("reflects credential clearing on update in the bridge targets API", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const bridgeToken = process.env.AGENTGATEWAY_TARGETS_TOKEN?.trim();
    test.skip(!bridgeToken, "AGENTGATEWAY_TARGETS_TOKEN is required for bridge contract tests.");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputId = `clear-${suffix}`;
    const serverId = `mcp-${inputId}`;

    await installLiveSession(page, env);

    try {
      const create = await fetchJson(page, "/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: inputId,
          name: `E2E Clear Credentials ${suffix}`,
          description: "Live bridge contract fixture",
          transport: "http",
          endpoint: "https://mcp-clear.example.test/mcp",
          agentgateway_target_endpoint: "https://mcp-clear.example.test/mcp",
          credential_sources: [
            {
              kind: "caller_token",
              target: "header",
              name: "X-CAIPE-Provider-Token",
            },
          ],
          enabled: true,
        }),
      });
      expect(create.status, JSON.stringify(create.body)).toBe(201);

      let bridge = await fetchBridgeTargets(page, bridgeToken);
      expect(bridge.status, JSON.stringify(bridge.body)).toBe(200);
      expect(bridgeTarget(bridge.body, serverId)?.credential_sources).toEqual([
        expect.objectContaining({
          kind: "caller_token",
          name: "X-CAIPE-Provider-Token",
        }),
      ]);

      const update = await fetchJson(page, `/api/mcp-servers?id=${encodeURIComponent(serverId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `E2E Clear Credentials ${suffix}`,
          transport: "http",
          endpoint: "https://mcp-clear.example.test/mcp",
          agentgateway_target_endpoint: "https://mcp-clear.example.test/mcp",
          credential_sources: [],
        }),
      });
      expect(update.status, JSON.stringify(update.body)).toBe(200);

      bridge = await fetchBridgeTargets(page, bridgeToken);
      expect(bridge.status, JSON.stringify(bridge.body)).toBe(200);
      expect(bridgeTarget(bridge.body, serverId)?.credential_sources).toEqual([]);
    } finally {
      await bestEffortDeleteMcpServer(page, serverId);
    }
  });

  test("reports built-in jira with empty credential_sources when configured upstream-only", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const bridgeToken = process.env.AGENTGATEWAY_TARGETS_TOKEN?.trim();
    test.skip(!bridgeToken, "AGENTGATEWAY_TARGETS_TOKEN is required for bridge contract tests.");

    await installLiveSession(page, env);
    await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    const bridge = await fetchBridgeTargets(page, bridgeToken);
    expect(bridge.status, JSON.stringify(bridge.body)).toBe(200);

    const jira = bridgeTarget(bridge.body, "jira");
    test.skip(!jira, "Built-in jira MCP server is not registered in this stack.");
    expect(jira?.credential_sources).toEqual([]);
    expect(jira?.target_endpoint).toMatch(/mcp-jira/i);
  });
});
