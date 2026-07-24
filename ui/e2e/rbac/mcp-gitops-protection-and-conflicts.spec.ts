// assisted-by claude code claude-sonnet-4-6

import { expect, test } from "@playwright/test";

import {
  gotoMcpServersTab,
  installMcpBrowserMocks,
  openMcpServerEditor,
} from "./_mcp-browser-fixtures";
import { mockedRbacEnabled } from "./_mocked-rbac";

test.describe("RBAC e2e — gitops (config_driven) MCP server protection", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked MCP gitops-protection regression.",
    );
  });

  test("locks a config_driven server for edit/delete even when source is agentgateway", async ({
    page,
  }) => {
    // Before the config_driven-alone lock fix, source: "agentgateway" made a
    // gitops-owned row look editable in the UI even though seed silently
    // discards any edit on the next restart. config_driven: true must lock
    // regardless of source.
    await installMcpBrowserMocks(page, {
      servers: [
        {
          _id: "argocd",
          name: "ArgoCD",
          transport: "http",
          endpoint: "http://mcp-argocd:8000/mcp",
          enabled: true,
          config_driven: true,
          source: "agentgateway",
          agentgateway_target_endpoint: "http://mcp-argocd:8000/mcp",
          permissions: { can_manage: true, can_invoke: true, can_discover: true },
        },
      ],
      capabilities: { repair_agentgateway: true },
    });

    await gotoMcpServersTab(page);
    await expect(page.getByText("ArgoCD")).toBeVisible();

    const configBadge = page.getByText("Config", { exact: true });
    await expect(configBadge).toBeVisible();
    await expect(configBadge).toHaveAttribute("title", /cannot be edited/i);

    // No delete control for a locked row.
    await expect(page.getByRole("button", { name: /Delete ArgoCD/i })).toHaveCount(0);

    // The enabled/disabled toggle is present but disabled, with a locked title.
    const toggle = page.getByTitle("Config-driven servers cannot be modified");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
  });

  test("does not lock a non-config_driven AgentGateway-discovered server", async ({ page }) => {
    // Contrast case: a purely UI-discovered row (config_driven: false) stays
    // editable, since nothing re-applies gitops state over it on restart.
    await installMcpBrowserMocks(page, {
      servers: [
        {
          _id: "mcp-discovered",
          name: "Discovered Tool",
          transport: "http",
          endpoint: "http://agentgateway:4000/mcp/mcp-discovered",
          enabled: true,
          config_driven: false,
          source: "agentgateway",
          agentgateway_target_endpoint: "http://mcp-discovered:8000/mcp",
          permissions: { can_manage: true, can_invoke: true, can_discover: true },
        },
      ],
    });

    await gotoMcpServersTab(page);
    await openMcpServerEditor(page, "Discovered Tool");
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  });

  test("shows a conflict banner without silently rewriting a direct-registered server", async ({
    page,
  }) => {
    // Before removing the "legacy" auto-migration branch, a direct
    // registration whose endpoint matched a live AgentGateway upstream got a
    // full-document overwrite (name/config_driven/credential_sources
    // clobbered) on every Repair click. It must now surface as a conflict
    // and require explicit admin action instead.
    const mocks = await installMcpBrowserMocks(page, {
      servers: [
        {
          _id: "jira",
          name: "My Jira (hand-registered)",
          transport: "http",
          endpoint: "http://mcp-jira:8000/mcp",
          enabled: true,
          config_driven: false,
          credential_sources: [
            { kind: "secret_ref", name: "Authorization", target: "header", secret_ref: "jira-token" },
          ],
          permissions: { can_manage: true, can_invoke: true, can_discover: true },
        },
      ],
      capabilities: { repair_agentgateway: true },
      syncResponse: {
        added: [],
        refreshed: [],
        skipped: [{ id: "jira", reason: "conflict" }],
        summary: { added: 0, existing: 0, refreshed: 0, conflicts: 1, skipped: 1 },
        conflicts: [
          {
            id: "jira",
            endpoint: "http://agentgateway:4000/mcp/jira",
            target_endpoint: "http://mcp-jira:8000/mcp",
            existing_endpoint: "http://mcp-jira:8000/mcp",
            status: "conflict",
          },
        ],
        migration_warnings: [
          {
            id: "jira",
            endpoint: "http://agentgateway:4000/mcp/jira",
            target_endpoint: "http://mcp-jira:8000/mcp",
            existing_endpoint: "http://mcp-jira:8000/mcp",
            message: 'MCP server "jira" conflicts with a live AgentGateway target.',
          },
        ],
      },
    });

    await gotoMcpServersTab(page);
    await expect(page.getByText("My Jira (hand-registered)")).toBeVisible();

    await page.getByRole("button", { name: /Repair AgentGateway/i }).click();
    await expect.poll(() => mocks.syncRequests).toBe(1);

    await expect(page.getByText(/1 legacy MCP server conflicts with AgentGateway targets/i)).toBeVisible();
    await expect(page.getByText(/Remove or rename the legacy MCP server/i)).toBeVisible();
    await expect(page.getByText(/Current: http:\/\/mcp-jira:8000\/mcp/i)).toBeVisible();

    // The row itself is untouched -- still the admin's own name, not
    // silently replaced by an auto-generated "Jira" from discovery.
    await expect(page.getByText("My Jira (hand-registered)")).toBeVisible();
  });
});
