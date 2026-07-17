// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";

import {
  fillNewMcpServerBasics,
  gotoMcpServersTab,
  installMcpBrowserMocks,
  MCP_BROWSER_MEMBER_SESSION,
  openAddMcpServerEditor,
  openMcpServerEditor,
  openMcpTestModal,
  selectAgentGatewayTarget,
  selectMcpTestTool,
  waitForMcpTestToolsLoaded,
} from "./_mcp-browser-fixtures";
import { mockedRbacEnabled } from "./_mocked-rbac";

const ADMIN_ATLASSIAN_CONNECTION = {
  id: "conn-admin-atlassian",
  connectorId: "atlassian-connector",
  provider: "atlassian",
  status: "connected",
};

const MEMBER_ATLASSIAN_CONNECTION = {
  id: "conn-member-atlassian",
  connectorId: "atlassian-connector",
  provider: "atlassian",
  status: "connected",
};

test.describe("RBAC e2e — MCP caller-scoped provider credentials", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked MCP pinned credential regression.",
    );
  });

  test("creates a custom MCP server with caller-scoped provider credentials", async ({
    page,
  }) => {
    const mocks = await installMcpBrowserMocks(page, {
      servers: [],
      providerConnections: [ADMIN_ATLASSIAN_CONNECTION],
      oauthConnectors: [
        { id: "atlassian-connector", name: "Atlassian Cloud", provider: "atlassian" },
      ],
    });

    await gotoMcpServersTab(page);
    await openAddMcpServerEditor(page);
    await fillNewMcpServerBasics(page, {
      displayName: "Caller Jira MCP",
      serverId: "caller-jira",
    });
    await selectAgentGatewayTarget(page, /Jira/i);
    await expect(page.getByRole("button", { name: /Streamable HTTP.*recommended/i })).toBeVisible();

    await page.getByRole("button", { name: "Add Credential" }).click();
    await page.getByLabel(/Credential kind/i).selectOption("provider_connection");
    await page.getByLabel(/^Provider$/i).selectOption("atlassian");
    await page.getByRole("button", { name: "Create Server" }).click();

    await expect.poll(() => mocks.createRequests.length).toBe(1);
    expect(mocks.createRequests[0].credential_sources).toEqual([
      {
        kind: "provider_connection",
        target: "header",
        name: "X-CAIPE-Provider-Token",
        connection_scope: "caller",
        provider: "atlassian",
      },
    ]);
    expect(mocks.createRequests[0].credential_sources?.[0]).not.toHaveProperty(
      "provider_connection_id",
    );
  });

  test("persists caller scope with provider key when selected in the editor", async ({ page }) => {
    const mocks = await installMcpBrowserMocks(page, {
      servers: [],
      providerConnections: [ADMIN_ATLASSIAN_CONNECTION],
      oauthConnectors: [
        { id: "atlassian-connector", name: "Atlassian Cloud", provider: "atlassian" },
      ],
    });

    await gotoMcpServersTab(page);
    await openAddMcpServerEditor(page);
    await fillNewMcpServerBasics(page, {
      displayName: "Caller Jira MCP",
      serverId: "caller-jira",
    });
    await selectAgentGatewayTarget(page, /Jira/i);
    await expect(page.getByRole("button", { name: /Streamable HTTP.*recommended/i })).toBeVisible();

    await page.getByRole("button", { name: "Add Credential" }).click();
    await page.getByLabel(/Credential kind/i).selectOption("provider_connection");
    await page.getByLabel(/^Provider$/i).selectOption("atlassian");
    await page.getByRole("button", { name: "Create Server" }).click();

    await expect.poll(() => mocks.createRequests.length).toBe(1);
    expect(mocks.createRequests[0].credential_sources).toEqual([
      {
        kind: "provider_connection",
        target: "header",
        name: "X-CAIPE-Provider-Token",
        connection_scope: "caller",
        provider: "atlassian",
      },
    ]);
    expect(mocks.createRequests[0].credential_sources?.[0]).not.toHaveProperty(
      "provider_connection_id",
    );
  });

  test("updates an existing custom server to caller-scoped provider credentials", async ({
    page,
  }) => {
    const mocks = await installMcpBrowserMocks(page, {
      servers: [
        {
          _id: "mcp-custom-jira",
          name: "Custom Jira",
          transport: "http",
          endpoint: "http://agentgateway:4000/mcp/mcp-custom-jira",
          enabled: true,
          config_driven: false,
          credential_sources: [],
        },
      ],
      providerConnections: [ADMIN_ATLASSIAN_CONNECTION],
      oauthConnectors: [
        { id: "atlassian-connector", name: "Atlassian Cloud", provider: "atlassian" },
      ],
    });

    await gotoMcpServersTab(page);
    await openMcpServerEditor(page, "Custom Jira");
    await page.getByRole("button", { name: "Add Credential" }).click();
    await page.getByLabel(/Credential kind/i).selectOption("provider_connection");
    await page.getByLabel(/^Provider$/i).selectOption("atlassian");
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect.poll(() => mocks.updateRequests.length).toBe(1);
    expect(mocks.updateRequests[0].body.credential_sources).toEqual([
      {
        kind: "provider_connection",
        target: "header",
        name: "X-CAIPE-Provider-Token",
        connection_scope: "caller",
        provider: "atlassian",
      },
    ]);
    expect(mocks.updateRequests[0].body.credential_sources?.[0]).not.toHaveProperty(
      "provider_connection_id",
    );
  });

  test("does not render the connection scope or per-connection picker for provider credentials", async ({
    page,
  }) => {
    await installMcpBrowserMocks(page, {
      servers: [],
      providerConnections: [ADMIN_ATLASSIAN_CONNECTION],
      oauthConnectors: [
        { id: "atlassian-connector", name: "Atlassian Cloud", provider: "atlassian" },
      ],
    });

    await gotoMcpServersTab(page);
    await openAddMcpServerEditor(page);
    await page.getByRole("button", { name: "Add Credential" }).click();
    await page.getByLabel(/Credential kind/i).selectOption("provider_connection");

    // The removed "Connection scope" and "Provider connection" pickers must not appear
    await expect(page.getByLabel(/Connection scope/i)).toHaveCount(0);
    await expect(page.getByLabel(/Provider connection/i)).toHaveCount(0);

    // The Provider dropdown (OAuth connector key) must be present
    await expect(page.getByLabel(/^Provider$/i)).toBeVisible();

    // Helper text confirming caller-scoped behavior
    await expect(page.getByText(/each caller uses their own/i)).toBeVisible();
  });

  test("does not show connection scope on config-driven built-in servers", async ({ page }) => {
    await installMcpBrowserMocks(page, {
      servers: [
        {
          _id: "jira",
          name: "Jira",
          transport: "http",
          endpoint: "http://agentgateway:4000/mcp/jira",
          enabled: true,
          config_driven: true,
          credential_sources: [
            {
              kind: "provider_connection",
              target: "header",
              name: "X-CAIPE-Provider-Token",
              provider: "atlassian",
            },
          ],
        },
      ],
      providerConnections: [ADMIN_ATLASSIAN_CONNECTION],
    });

    await gotoMcpServersTab(page);
    await openMcpServerEditor(page, "Jira");
    await expect(page.getByLabel(/Connection scope/i)).toHaveCount(0);
    await expect(page.getByLabel(/Provider connection/i)).toHaveCount(0);
  });

  test("member can exercise test modal for a legacy pinned server fixture", async ({ page }) => {
    const mocks = await installMcpBrowserMocks(page, {
      isAdmin: false,
      session: MCP_BROWSER_MEMBER_SESSION,
      servers: [
        {
          _id: "mcp-pinned-jira",
          name: "Pinned Jira",
          transport: "http",
          endpoint: "http://agentgateway:4000/mcp/mcp-pinned-jira",
          enabled: true,
          config_driven: false,
          credential_sources: [
            {
              kind: "provider_connection",
              target: "header",
              name: "X-CAIPE-Provider-Token",
              connection_scope: "pinned",
              provider_connection_id: ADMIN_ATLASSIAN_CONNECTION.id,
            },
          ],
          permissions: {
            can_manage: false,
            can_invoke: true,
            can_discover: true,
          },
        },
      ],
      providerConnections: [MEMBER_ATLASSIAN_CONNECTION],
      testToolResponder: (body) => ({
        success: true,
        application_success: true,
        status: 200,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: true, tool: body.toolName }) }],
        },
        credential_resolution: [
          {
            name: "X-CAIPE-Provider-Token",
            kind: "provider_connection",
            origin: "provider_connection",
            connection_scope: "caller",
            provider: "atlassian",
          },
        ],
      }),
    });

    await gotoMcpServersTab(page);
    await openMcpTestModal(page, "Pinned Jira");
    await waitForMcpTestToolsLoaded(page);
    await selectMcpTestTool(page, "version");
    await page.getByRole("button", { name: "Run tool" }).click();

    await expect(page.getByText(/Credential resolution/i)).toBeVisible();
    await expect(page.getByText(/provider_connection \(atlassian\)/i)).toBeVisible();
    await expect.poll(() => mocks.testToolRequests.length).toBe(1);
    expect(mocks.testToolRequests[0].serverId).toBe("mcp-pinned-jira");
  });
});
