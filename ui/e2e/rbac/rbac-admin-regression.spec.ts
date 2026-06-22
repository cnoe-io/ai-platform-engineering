// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

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

function policyManifestRecords() {
  return [
    {
      id: "slack_channel_team_assignment_v1",
      family: "messaging_team_assignment",
      surface: "slack",
      title: "Slack channel team assignment",
      description:
        "Assigning a Slack channel to a team lets team members use and manage the channel integration; team admins also manage it.",
      trigger: "admin assigns or reassigns a Slack channel to a team",
      feature: {
        name: "Slack integrations",
        summary:
          "Slack integrations let teams choose which bot routes and agents answer in their Slack channels.",
        subfeatures: [
          {
            name: "Configured channels",
            behavior: "Team members see the Slack channels shared with their team.",
            authorization: "A shared channel gives that team's members access to view and update that channel's routing.",
          },
          {
            name: "Channel routing",
            behavior: "Team members can choose which agent answers in a shared channel.",
            authorization: "The selected agent still needs to be usable by both the channel and the user's team.",
          },
        ],
      },
      grants: [
        {
          subject: { type: "team", parameter: "teamSlug", relation: "admin" },
          action: "manage",
          resource: { type: "slack_channel", parameter: "slackChannelId" },
        },
        {
          subject: { type: "team", parameter: "teamSlug", relation: "member" },
          action: "use",
          resource: { type: "slack_channel", parameter: "slackChannelId" },
        },
        {
          subject: { type: "team", parameter: "teamSlug", relation: "member" },
          action: "manage",
          resource: { type: "slack_channel", parameter: "slackChannelId" },
        },
      ],
    },
    {
      id: "webex_space_team_assignment_v1",
      family: "messaging_team_assignment",
      surface: "webex",
      title: "Webex space team assignment",
      description:
        "Assigning a Webex space to a team lets team members use the space integration; team admins manage it.",
      trigger: "admin assigns or reassigns a Webex space to a team",
      feature: {
        name: "Webex integrations",
        summary:
          "Webex integrations let teams connect spaces to CAIPE routing so messages can reach the right agents.",
        subfeatures: [
          {
            name: "Configured spaces",
            behavior: "Team members can use Webex spaces that are shared with their team.",
            authorization: "The space assignment creates team access for that Webex space.",
          },
        ],
      },
      grants: [
        {
          subject: { type: "team", parameter: "teamSlug", relation: "admin" },
          action: "manage",
          resource: { type: "webex_space", parameter: "webexSpaceId" },
        },
        {
          subject: { type: "team", parameter: "teamSlug", relation: "member" },
          action: "use",
          resource: { type: "webex_space", parameter: "webexSpaceId" },
        },
      ],
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

  test("audit log expands policy details and downloads the filtered ZIP payload", async ({
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
    expect(download.suggestedFilename()).toMatch(/^rbac-audit-log-.*\.zip$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const zip = await JSZip.loadAsync(await readFile(downloadPath!));
    const auditEvents = JSON.parse(await zip.file("audit-events.json")!.async("string"));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.record_count).toBe(2);
    expect(auditEvents[0].correlation_id).toBe("corr-grant");

    await page.locator("select").nth(1).selectOption("cas_grant");
    await page.getByRole("button", { name: /^Search$/ }).click();

    await expect.poll(() => auditQueries.some((query) => query.includes("type=cas_grant"))).toBe(true);
    await expect(page.getByText("1 event found")).toBeVisible();
    await expect(page.getByText("Denied to manage agent agent-private")).toHaveCount(0);
  });

  test("policy manifest visualizes reusable sharing rules without exposing tuple details by default", async ({
    page,
  }) => {
    const policies = policyManifestRecords();
    const policyHandler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/admin/openfga/catalog" && method === "GET") {
        await fulfillJson(route, {
          data: {
            status: {
              configured: true,
              reconcile_enabled: true,
              store_name: "playwright-openfga",
            },
            teams: [],
            resource_types: [],
            actions: {},
            resources: {
              agents: [],
              tools: [],
              knowledge_bases: [],
              by_type: {},
            },
            universal_resources: [],
          },
        });
        return true;
      }

      if (path === "/api/admin/openfga/tuples" && method === "GET") {
        await fulfillJson(route, { data: { tuples: [] } });
        return true;
      }

      if (path === "/api/admin/rebac/graph" && method === "GET") {
        await fulfillJson(route, { data: { nodes: [], edges: [] } });
        return true;
      }

      if (path === "/api/admin/rebac/policies/catalog" && method === "GET") {
        await fulfillJson(route, {
          data: {
            policies,
            count: policies.length,
            filters: {
              surface: url.searchParams.get("surface"),
              resource_type: url.searchParams.get("resource_type"),
              family: url.searchParams.get("family"),
            },
          },
        });
        return true;
      }

      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [policyHandler],
    });

    await page.goto("/admin?cat=security&tab=openfga&subtab=manifest", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("tab", { name: "Policy Manifest" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Sharing Rules" })).toBeVisible();
    await expect(page.getByTestId("policy-manifest-slack_channel_team_assignment_v1")).toContainText(
      "When a Slack channel is assigned to a team"
    );
    await expect(page.getByTestId("policy-manifest-webex_space_team_assignment_v1")).toContainText(
      "When a Webex space is assigned to a team"
    );
    const slackPolicy = page.getByTestId("policy-manifest-slack_channel_team_assignment_v1");
    await expect(slackPolicy.getByText("Slack integrations", { exact: true })).toBeVisible();
    await expect(slackPolicy.getByText("Configured channels")).toBeVisible();
    await expect(slackPolicy.getByText("Team members can choose which agent answers in a shared channel.")).toBeVisible();
    await expect(slackPolicy.getByText("Team members can change settings for this Slack channel.")).toBeVisible();
    await expect(slackPolicy.getByText("teamSlug").first()).toBeHidden();
    await expect(slackPolicy.getByText("team:{teamSlug}#member").first()).toBeHidden();

    await slackPolicy.getByRole("button", { name: "View manifest" }).click();
    const dialog = page.getByRole("dialog", { name: "Policy manifest" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('id: "slack_channel_team_assignment_v1"')).toBeVisible();
    await dialog.getByRole("tab", { name: "JSON" }).click();
    await expect(dialog.getByText('"id": "slack_channel_team_assignment_v1"')).toBeVisible();

    const yamlDownloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download YAML" }).click();
    const yamlDownload = await yamlDownloadPromise;
    expect(yamlDownload.suggestedFilename()).toBe("slack_channel_team_assignment_v1.yaml");
    const yamlPath = await yamlDownload.path();
    expect(yamlPath).toBeTruthy();
    expect(await readFile(yamlPath!, "utf8")).toContain('family: "messaging_team_assignment"');

    const jsonDownloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download JSON" }).click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toBe("slack_channel_team_assignment_v1.json");
    const jsonPath = await jsonDownload.path();
    expect(jsonPath).toBeTruthy();
    expect(JSON.parse(await readFile(jsonPath!, "utf8")).id).toBe("slack_channel_team_assignment_v1");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByLabel("Product").selectOption("slack");
    await expect(page.getByTestId("policy-manifest-slack_channel_team_assignment_v1")).toBeVisible();
    await expect(page.getByTestId("policy-manifest-webex_space_team_assignment_v1")).toHaveCount(0);

    await slackPolicy.getByText("Show technical mapping").click();
    await expect(slackPolicy.getByText("team:{teamSlug}#member").first()).toBeVisible();
  });
});
