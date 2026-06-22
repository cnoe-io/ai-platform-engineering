// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";

import {
  DEFAULT_OAUTH_CONNECTOR,
  gotoPersonalCredentialsConnections,
  installCredentialsBrowserMocks,
} from "./_credentials-browser-fixtures";
import {
  gotoMcpServersTab,
  installMcpBrowserMocks,
  openAddMcpServerEditor,
  openMcpServerEditor,
} from "./_mcp-browser-fixtures";
import {
  ATLASSIAN_OPTION_LABEL,
  ATLASSIAN_OPTION_LABEL_NO_PROFILE,
  EXPIRED_ATLASSIAN_CONNECTION,
  EXPIRED_OPTION_LABEL_PATTERN,
  GITHUB_PROVIDER_CONNECTION,
  NEW_ATLASSIAN_CONNECTION,
  OLD_ATLASSIAN_CONNECTION,
} from "./_provider-connection-fixtures";
import { dismissReleaseUpgradeDialog } from "./_helpers";
import { mockedRbacEnabled } from "./_mocked-rbac";

const GITHUB_OAUTH_CONNECTOR = {
  id: "github-connector",
  name: "GitHub",
  provider: "github",
  enabled: true,
  scopes: ["repo", "read:user"],
};

test.describe("RBAC e2e — provider connection display and cleanup", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked provider connection display regression.",
    );
  });

  test.describe("Connected Apps workspace", () => {
    test("shows profile summary, health, and relative refresh for the newest connection", async ({
      page,
    }) => {
      await installCredentialsBrowserMocks(page, {
        providerConnections: [NEW_ATLASSIAN_CONNECTION, OLD_ATLASSIAN_CONNECTION],
      });
      await gotoPersonalCredentialsConnections(page);
      await dismissReleaseUpgradeDialog(page);

      await expect(page.getByRole("heading", { name: "Connected Apps" })).toBeVisible();
      await expect(page.getByText("Atlassian Cloud")).toBeVisible();
      await expect(page.getByText("cisco-eti")).toBeVisible();
      await expect(page.getByText("healthy")).toBeVisible();
      await expect(page.getByText(/refreshed 30m ago/i)).toBeVisible();
      await expect(page.getByText("legacy-site")).toHaveCount(0);
      await expect(page.getByText("expired")).toHaveCount(0);
    });

    test("falls back to owner email when profile summary is absent", async ({ page }) => {
      const connectionWithoutSummary = {
        ...NEW_ATLASSIAN_CONNECTION,
        profileSummary: undefined,
      };
      await installCredentialsBrowserMocks(page, {
        providerConnections: [connectionWithoutSummary],
      });
      await gotoPersonalCredentialsConnections(page);
      await dismissReleaseUpgradeDialog(page);

      await expect(page.getByText("sraradhy@cisco.com")).toBeVisible();
      await expect(page.getByText("cisco-eti")).toHaveCount(0);
    });

    test("surfaces expired health when the active connection token is expired", async ({ page }) => {
      await installCredentialsBrowserMocks(page, {
        providerConnections: [EXPIRED_ATLASSIAN_CONNECTION],
      });
      await gotoPersonalCredentialsConnections(page);
      await dismissReleaseUpgradeDialog(page);

      await expect(page.getByText("expired")).toBeVisible();
      await expect(page.getByText(/connection expired/i)).toBeVisible();
    });

    test("runs profile checks against the selected connection id", async ({ page }) => {
      const profileChecks: string[] = [];
      await page.route("**/api/credentials/connections/*/profile", async (route) => {
        const connectionId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
        profileChecks.push(connectionId);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              ok: true,
              provider: "atlassian",
              accessible_resources: [{ name: "cisco-eti", scopes: ["read:jira-user"] }],
              diagnostics: [
                {
                  id: "atlassian_accessible_resources",
                  label: "Accessible Atlassian sites",
                  status: "passed",
                  detail: "cisco-eti is accessible.",
                  action: "No action needed.",
                },
              ],
            },
          }),
        });
      });

      await installCredentialsBrowserMocks(page, {
        providerConnections: [NEW_ATLASSIAN_CONNECTION],
      });
      await gotoPersonalCredentialsConnections(page);
      await dismissReleaseUpgradeDialog(page);

      await page.getByRole("button", { name: /test atlassian connection/i }).click();
      await expect(page.getByText(/Atlassian access check passed: cisco-eti/i)).toBeVisible();
      expect(profileChecks).toEqual([NEW_ATLASSIAN_CONNECTION.id]);
    });

    test("lists a single active row after simulated stale-connection prune", async ({ page }) => {
      await installCredentialsBrowserMocks(page, {
        providerConnections: [NEW_ATLASSIAN_CONNECTION],
      });
      await gotoPersonalCredentialsConnections(page);
      await dismissReleaseUpgradeDialog(page);

      await expect(page.getByText("Atlassian Cloud")).toHaveCount(1);
      await expect(page.getByText("cisco-eti")).toBeVisible();
      await expect(page.getByText("legacy-site")).toHaveCount(0);
    });
  });

  test.describe("MCP credential editor", () => {
    test("shows descriptive connected-app labels instead of raw UUIDs", async ({ page }) => {
      await installMcpBrowserMocks(page, {
        servers: [],
        providerConnections: [NEW_ATLASSIAN_CONNECTION],
        oauthConnectors: [DEFAULT_OAUTH_CONNECTOR],
      });

      await gotoMcpServersTab(page);
      await openAddMcpServerEditor(page);
      await page.getByRole("button", { name: "Add Credential" }).click();
      await page.getByLabel(/Credential kind/i).selectOption("provider_connection");

      const providerConnection = page.getByLabel(/Provider connection/i);
      await expect(providerConnection).toContainText("Atlassian Cloud");
      await expect(providerConnection).toContainText("healthy");
      await expect(providerConnection).toContainText("refreshed 30m ago");
      await expect(providerConnection).toContainText("cisco-eti");
      await expect(providerConnection.getByRole("option", { name: ATLASSIAN_OPTION_LABEL })).toHaveAttribute(
        "title",
        NEW_ATLASSIAN_CONNECTION.id,
      );
      await expect(page.getByText(NEW_ATLASSIAN_CONNECTION.id)).toHaveCount(0);
    });

    test("falls back to owner email in the MCP picker when profile summary is missing", async ({
      page,
    }) => {
      await installMcpBrowserMocks(page, {
        servers: [],
        providerConnections: [{ ...NEW_ATLASSIAN_CONNECTION, profileSummary: undefined }],
        oauthConnectors: [DEFAULT_OAUTH_CONNECTOR],
      });

      await gotoMcpServersTab(page);
      await openAddMcpServerEditor(page);
      await page.getByRole("button", { name: "Add Credential" }).click();
      await page.getByLabel(/Credential kind/i).selectOption("provider_connection");

      await expect(page.getByLabel(/Provider connection/i)).toContainText("sraradhy@cisco.com");
      await expect(
        page.getByLabel(/Provider connection/i).getByRole("option", {
          name: ATLASSIAN_OPTION_LABEL_NO_PROFILE,
        }),
      ).toBeVisible();
    });

    test("shows expired health in the MCP picker for stale tokens", async ({ page }) => {
      await installMcpBrowserMocks(page, {
        servers: [],
        providerConnections: [EXPIRED_ATLASSIAN_CONNECTION],
        oauthConnectors: [DEFAULT_OAUTH_CONNECTOR],
      });

      await gotoMcpServersTab(page);
      await openAddMcpServerEditor(page);
      await page.getByRole("button", { name: "Add Credential" }).click();
      await page.getByLabel(/Credential kind/i).selectOption("provider_connection");

      await expect(
        page.getByLabel(/Provider connection/i).getByRole("option", {
          name: EXPIRED_OPTION_LABEL_PATTERN,
        }),
      ).toBeVisible();
    });

    test("distinguishes multiple provider connections with readable labels", async ({ page }) => {
      await installMcpBrowserMocks(page, {
        servers: [],
        providerConnections: [NEW_ATLASSIAN_CONNECTION, GITHUB_PROVIDER_CONNECTION],
        oauthConnectors: [DEFAULT_OAUTH_CONNECTOR, GITHUB_OAUTH_CONNECTOR],
      });

      await gotoMcpServersTab(page);
      await openAddMcpServerEditor(page);
      await page.getByRole("button", { name: "Add Credential" }).click();
      await page.getByLabel(/Credential kind/i).selectOption("provider_connection");

      const providerConnection = page.getByLabel(/Provider connection/i);
      await expect(providerConnection.getByRole("option")).toHaveCount(3);
      await expect(providerConnection).toContainText("cisco-eti");
      await expect(providerConnection).toContainText("@octocat");
      await expect(page.getByText(NEW_ATLASSIAN_CONNECTION.id)).toHaveCount(0);
      await expect(page.getByText(GITHUB_PROVIDER_CONNECTION.id)).toHaveCount(0);
    });

    test("persists the selected provider connection id on save", async ({ page }) => {
      const mocks = await installMcpBrowserMocks(page, {
        servers: [],
        providerConnections: [NEW_ATLASSIAN_CONNECTION],
        oauthConnectors: [DEFAULT_OAUTH_CONNECTOR],
      });

      await gotoMcpServersTab(page);
      await openAddMcpServerEditor(page);
      await page.getByLabel(/Display Name/i).fill("Atlassian MCP");
      await page.getByLabel(/Endpoint URL/i).fill("http://agentgateway:4000/mcp/atlassian");
      await page.getByRole("button", { name: "Add Credential" }).click();
      await page.getByLabel(/Credential kind/i).selectOption("provider_connection");
      await page
        .getByLabel(/Provider connection/i)
        .selectOption({ label: ATLASSIAN_OPTION_LABEL });

      await page.getByRole("button", { name: "Create Server" }).click();

      await expect.poll(() => mocks.createRequests.length).toBe(1);
      expect(mocks.createRequests[0].credential_sources).toEqual([
        {
          kind: "provider_connection",
          target: "header",
          name: "Authorization",
          provider_connection_id: NEW_ATLASSIAN_CONNECTION.id,
          provider: "atlassian",
        },
      ]);
    });

    test("reloads existing server bindings with descriptive provider connection labels", async ({
      page,
    }) => {
      await installMcpBrowserMocks(page, {
        servers: [
          {
            _id: "mcp-jira",
            name: "Jira",
            transport: "http",
            endpoint: "http://agentgateway:4000/mcp/jira",
            enabled: true,
            credential_sources: [
              {
                kind: "provider_connection",
                target: "header",
                name: "Authorization",
                provider: "atlassian",
                provider_connection_id: NEW_ATLASSIAN_CONNECTION.id,
              },
            ],
          },
        ],
        providerConnections: [NEW_ATLASSIAN_CONNECTION],
        oauthConnectors: [DEFAULT_OAUTH_CONNECTOR],
      });

      await gotoMcpServersTab(page);
      await openMcpServerEditor(page, "Jira");

      const providerConnection = page.getByLabel(/Provider connection/i);
      await expect(providerConnection).toHaveValue(NEW_ATLASSIAN_CONNECTION.id);
      await expect(providerConnection).toContainText("cisco-eti");
      await expect(providerConnection).toContainText("healthy");
    });
  });

  test.describe("connection revoke API", () => {
    test("marks revoked connections disabled in the mock store", async ({ page }) => {
      const mocks = await installCredentialsBrowserMocks(page, {
        providerConnections: [NEW_ATLASSIAN_CONNECTION, OLD_ATLASSIAN_CONNECTION],
      });
      await gotoPersonalCredentialsConnections(page);
      await dismissReleaseUpgradeDialog(page);

      const response = await page.evaluate(async (connectionId) => {
        const result = await fetch(`/api/credentials/connections/${connectionId}`, {
          method: "DELETE",
        });
        return { ok: result.ok, status: result.status };
      }, OLD_ATLASSIAN_CONNECTION.id);

      expect(response.ok).toBe(true);
      expect(mocks.connectionRevokeRequests).toEqual([OLD_ATLASSIAN_CONNECTION.id]);
      expect(
        mocks.providerConnections.find((connection) => connection.id === OLD_ATLASSIAN_CONNECTION.id)
          ?.status,
      ).toBe("disabled");
      expect(
        mocks.providerConnections.filter((connection) => connection.status === "connected"),
      ).toHaveLength(1);
    });
  });
});
