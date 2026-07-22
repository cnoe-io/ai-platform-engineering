// assisted-by Codex Codex-sonnet-4-6

import { expect, type Page, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  type MockRouteHandler,
} from "./_mocked-rbac";

const adminSession = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

const users = [
  {
    id: "user-sri",
    email: "sraradhy@cisco.com",
    firstName: "Sri",
    lastName: "Aradhyula",
    username: "sraradhy",
  },
];

const teams = [{ slug: "platform", name: "Platform Team" }];
const serviceAccounts = [{ id: "sa-sri-ci-bot", name: "Sri CI Robot" }];
const unlinkedServiceAccount = { id: "sa-unlinked", name: "unlinked" };
const agents = [{ _id: "agent-sri-assistant", name: "Sri Assistant Agent" }];
const skills = [{ id: "skill-sri-review", name: "Sri Review Skill", description: "Reviews pull requests" }];
const emptySkill = { id: "skill-empty", name: "Foo Empty Skill", description: "No grants yet" };
const datasources = [{ datasource_id: "kb-sri-runbooks", name: "Sri Runbooks", description: "Operational runbooks" }];
const credentials = [{ id: "secret-sri-github", name: "Sri GitHub Credential", type: "api_key" }];
const llmModels = [{ _id: "model-sri-gpt", model_id: "model-sri-gpt", name: "Sri GPT Model", provider: "openai" }];
const accessExplorerPlaceholder = "Search users, teams, agents, skills, data sources, credentials, or models.";

const effectiveGraph = {
  nodes: [
    { id: "user:user-sri", label: "Sri Aradhyula", type: "user" },
    { id: "team:platform#member", label: "Platform members", type: "userset" },
    { id: "agent:github", label: "GitHub Agent", type: "agent" },
    { id: "mcp_server:payments", label: "Payments MCP", type: "mcp_server" },
    { id: "slack_channel:C123", label: "#ops-alerts", type: "slack_channel" },
    { id: "organization:caipe", label: "CAIPE organization", type: "organization" },
  ],
  edges: [
    {
      id: "effective-user-agent",
      from: "user:user-sri",
      to: "agent:github",
      relation: "can_use",
      kind: "effective",
    },
    {
      id: "effective-team-mcp",
      from: "team:platform#member",
      to: "mcp_server:payments",
      relation: "can_use",
      kind: "effective",
    },
    {
      id: "effective-user-slack",
      from: "user:user-sri",
      to: "slack_channel:C123",
      relation: "can_read",
      kind: "effective",
    },
    {
      id: "effective-user-search",
      from: "user:user-sri",
      to: "organization:caipe",
      relation: "can_search",
      kind: "effective",
    },
    {
      id: "raw-team-membership",
      from: "user:user-sri",
      to: "team:platform#member",
      relation: "member",
      kind: "openfga",
    },
  ],
};

const agentRuntimeGraph = {
  nodes: [
    { id: "agent:github", label: "GitHub Agent", type: "agent" },
    { id: "tool:jira/*", label: "Jira MCP tools", type: "tool" },
    { id: "mcp_tool:caipe_kb", label: "CAIPE KB tool", type: "mcp_tool" },
    { id: "knowledge_base:kb-platform", label: "Platform KB", type: "knowledge_base" },
  ],
  edges: [
    {
      id: "effective-agent-tool",
      from: "agent:github",
      to: "tool:jira/*",
      relation: "can_call",
      kind: "effective",
    },
    {
      id: "effective-agent-mcp-tool",
      from: "agent:github",
      to: "mcp_tool:caipe_kb",
      relation: "can_call",
      kind: "effective",
    },
    {
      id: "effective-agent-kb",
      from: "agent:github",
      to: "knowledge_base:kb-platform",
      relation: "can_read",
      kind: "effective",
    },
  ],
};

const resourceGraph = {
  nodes: [
    { id: "team:platform#member", label: "Platform members", type: "userset" },
    { id: "skill:skill-sri-review", label: "Sri Review Skill", type: "skill" },
  ],
  edges: [
    {
      id: "effective-team-skill",
      from: "team:platform#member",
      to: "skill:skill-sri-review",
      relation: "can_use",
      kind: "effective",
    },
  ],
};

const emptySkillGraph = {
  nodes: [{ id: "skill:skill-empty", label: "Foo Empty Skill", type: "skill" }],
  edges: [],
};

const emptyAgentFeatureGraph = {
  nodes: [
    { id: "user:user-sri", label: "Sri Aradhyula", type: "user" },
    { id: "agent:agent-sri-assistant", label: "Sri Assistant Agent", type: "agent" },
  ],
  edges: [],
};

const datasourceGraph = {
  nodes: [
    { id: "team:platform#member", label: "Platform members", type: "userset" },
    { id: "data_source:kb-sri-runbooks", label: "Sri Runbooks", type: "data_source" },
  ],
  edges: [
    {
      id: "effective-team-datasource",
      from: "team:platform#member",
      to: "data_source:kb-sri-runbooks",
      relation: "can_read",
      kind: "effective",
    },
  ],
};

type AccessExplorerHarness = {
  graphSubjects: string[];
  graphRequests: Array<{
    subject: string;
    resourceType: string;
    resourceId: string;
  }>;
  searchEndpoints: Set<string>;
  releaseGraphResponse: () => void;
};

type AccessExplorerMockOptions = {
  holdGraphResponse?: boolean;
};

async function installAccessExplorerMocks(
  page: Page,
  options: AccessExplorerMockOptions = {},
): Promise<AccessExplorerHarness> {
  const graphSubjects: string[] = [];
  const graphRequests: AccessExplorerHarness["graphRequests"] = [];
  const searchEndpoints = new Set<string>();
  let releaseGraphResponse = () => {};
  const graphResponseGate = options.holdGraphResponse
    ? new Promise<void>((resolve) => {
        releaseGraphResponse = resolve;
      })
    : null;

  const accessExplorerHandler: MockRouteHandler = async ({ route, path, method, url }) => {
    if (method === "GET" && path === "/api/admin/users") {
      if (url.searchParams.has("search")) searchEndpoints.add("users");
      await fulfillJson(route, {
        success: true,
        users,
        data: { users, pagination: { page: 1, pageSize: 6, total: users.length } },
      });
      return true;
    }

    if (method === "GET" && path === "/api/admin/teams") {
      if (url.searchParams.has("search")) searchEndpoints.add("teams");
      await fulfillJson(route, {
        success: true,
        teams,
        data: { teams, pagination: { page: 1, page_size: 4, total: teams.length } },
      });
      return true;
    }

    if (method === "GET" && path === "/api/admin/service-accounts") {
      searchEndpoints.add("service-accounts");
      await fulfillJson(route, { success: true, data: { items: serviceAccounts } });
      return true;
    }

    if (method === "GET" && path === "/api/admin/service-accounts/unlinked") {
      searchEndpoints.add("unlinked-service-account");
      await fulfillJson(route, { success: true, data: unlinkedServiceAccount });
      return true;
    }

    if (method === "GET" && path === "/api/dynamic-agents") {
      searchEndpoints.add("agents");
      await fulfillJson(route, {
        success: true,
        data: { items: agents, total: agents.length, page: 1, page_size: 100 },
      });
      return true;
    }

    if (method === "GET" && path === "/api/admin/rebac/entity-search") {
      searchEndpoints.add("resource-search");
      await fulfillJson(route, {
        success: true,
        data: {
          skills: [...skills, emptySkill],
          datasources,
          credentials,
          models: llmModels,
        },
      });
      return true;
    }

    if (method === "GET" && path === "/api/admin/rebac/graph") {
      const subject = url.searchParams.get("subject") ?? "";
      graphSubjects.push(subject);
      graphRequests.push({
        subject,
        resourceType: url.searchParams.get("resource_type") ?? "",
        resourceId: url.searchParams.get("resource_id") ?? "",
      });
      if (graphResponseGate) await graphResponseGate;
      const resourceType = url.searchParams.get("resource_type") ?? "";
      const resourceId = url.searchParams.get("resource_id") ?? "";
      await fulfillJson(route, {
        data:
          resourceType === "skill"
            ? resourceId === "skill-empty"
              ? emptySkillGraph
              : resourceGraph
            : resourceType === "agent" && resourceId === "agent-sri-assistant" && subject === "user:user-sri"
              ? emptyAgentFeatureGraph
            : resourceType === "data_source"
              ? datasourceGraph
              : subject.startsWith("agent:")
                ? agentRuntimeGraph
                : effectiveGraph,
      });
      return true;
    }

    return false;
  };

  await installMockedRbacApp(page, {
    isAdmin: true,
    session: adminSession,
    handlers: [accessExplorerHandler],
  });

  return { graphSubjects, graphRequests, searchEndpoints, releaseGraphResponse };
}

async function gotoAccessExplorer(page: Page) {
  await page.goto("/admin?cat=security&tab=access-explorer", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("tab", { name: "Access Explorer" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function selectSriAndCheckAccess(page: Page) {
  await page
    .getByPlaceholder(accessExplorerPlaceholder)
    .fill("sri");
  await expect(page.getByText("Sri Aradhyula")).toBeVisible();
  await page.getByText("Sri Aradhyula").click();
  await expect(page.getByText("user:user-sri")).toBeVisible();
  await page.getByRole("button", { name: "Check Access" }).click();
  await expect(page.getByTestId("openfga-graph-canvas")).toBeVisible();
}

test.describe("mocked Access Explorer browser regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("opens the canonical access-explorer subtab without the old OpenFGA clutter", async ({
    page,
  }) => {
    await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);

    await expect(page).toHaveURL(/\/admin\?cat=security&tab=access-explorer$/);
    await expect(page.getByRole("button", { name: "Security & Policy" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Access Explorer" })).toHaveCount(0);
    await expect(page.getByTestId("access-explorer-search-stage")).toBeVisible();
    await expect(page.getByTestId("access-explorer-header")).toHaveCount(0);
    await expect(
      page.getByPlaceholder(accessExplorerPlaceholder),
    ).toBeVisible();

    await expect(page.getByText("Policy Graph")).toHaveCount(0);
    await expect(page.getByText("Effective Access Graph")).toHaveCount(0);
    await expect(page.getByText("Access control enabled")).toHaveCount(0);
    await expect(
      page.getByText(
        "Select a user to see every resource they can access and how. Grants are authored in Teams; this view is read-only.",
      ),
    ).toHaveCount(0);
    await expect(
      page.getByText("Search for a user above, then click Check Access to visualize their access."),
    ).toHaveCount(0);
    await expect(page.getByTestId("openfga-graph-canvas")).toHaveCount(0);
  });

  test("canonicalizes legacy tab=openfga links to tab=access-explorer", async ({ page }) => {
    await installAccessExplorerMocks(page);

    await page.goto("/admin?cat=security&tab=openfga", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/admin\?cat=security&tab=access-explorer$/);
    await expect(page.getByRole("tab", { name: "Access Explorer" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("access-explorer-search-stage")).toBeVisible();
  });

  test("shows browseable entities on focus before any search text is entered", async ({ page }) => {
    const harness = await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);

    const search = page.getByPlaceholder(accessExplorerPlaceholder);
    await search.focus();

    const explorer = page.getByLabel("Access Explorer");
    await expect(explorer.getByText("Users", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Agents", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Skills", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Data Sources", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Sri Aradhyula")).toBeVisible();
    await expect(explorer.getByText("Sri Assistant Agent")).toBeVisible();
    await expect(explorer.getByText("Sri Review Skill")).toBeVisible();
    await expect(explorer.getByText("Sri Runbooks")).toBeVisible();
    await expect.poll(() => [...harness.searchEndpoints].sort()).toEqual([
      "agents",
      "resource-search",
      "service-accounts",
      "teams",
      "unlinked-service-account",
      "users",
    ]);
  });

  test("searches actors and resource entities before rendering effective access", async ({
    page,
  }) => {
    const harness = await installAccessExplorerMocks(page, { holdGraphResponse: true });
    await gotoAccessExplorer(page);

    await page
      .getByPlaceholder(accessExplorerPlaceholder)
      .fill("sri");

    const explorer = page.getByLabel("Access Explorer");
    await expect(explorer.getByText("Users", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Teams", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Service Accounts", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Agents", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Skills", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Data Sources", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Chats", { exact: true })).toHaveCount(0);
    await expect(explorer.getByText("Credentials", { exact: true })).toBeVisible();
    await expect(explorer.getByText("LLM Models", { exact: true })).toBeVisible();
    await expect(explorer.getByText("Sri Aradhyula")).toBeVisible();
    await expect(explorer.getByText("Platform Team")).toBeVisible();
    await expect(explorer.getByText("Sri CI Robot")).toBeVisible();
    await expect(explorer.getByText("Sri Assistant Agent")).toBeVisible();
    await expect(explorer.getByText("Sri Review Skill")).toBeVisible();
    await expect(explorer.getByText("Sri Runbooks")).toBeVisible();
    await expect(explorer.getByText("Sri Troubleshooting Chat")).toHaveCount(0);
    await expect(explorer.getByText("Sri GitHub Credential")).toBeVisible();
    await expect(explorer.getByText("Sri GPT Model")).toBeVisible();

    await expect.poll(() => [...harness.searchEndpoints].sort()).toEqual([
      "agents",
      "resource-search",
      "service-accounts",
      "teams",
      "unlinked-service-account",
      "users",
    ]);

    await page.getByText("Sri Aradhyula").click();
    await expect(page.getByText("user:user-sri")).toBeVisible();
    await page.getByRole("button", { name: "Check Access" }).click();

    await expect(page.getByText("Checking access...")).toBeVisible();
    await expect(page.getByTestId("access-explorer-search-stage")).toHaveCount(0);
    harness.releaseGraphResponse();

    await expect.poll(() => harness.graphSubjects.includes("user:user-sri")).toBe(true);
    await expect.poll(() => harness.graphSubjects.includes("agent:github")).toBe(true);
    await expect(page.getByTestId("access-explorer-search-stage")).toHaveCount(0);
    await expect(page.getByTestId("access-explorer-header")).toBeVisible();
    await expect(page.getByTestId("feature-check-panel")).toBeVisible();
    await expect(page.getByText("Sri Aradhyula can perform this feature path.")).toBeVisible();
    await expect(page.getByText("Actor can invoke agent")).toBeVisible();
    await expect(page.getByText("Agent can call MCP/tool")).toBeVisible();
    await expect(page.getByTestId("rf__node-tool:jira/*").getByText("Jira MCP tools")).toBeVisible();

    await page.getByRole("tab", { name: "Relationships" }).click();
    const renderedCanvas = page.getByTestId("openfga-graph-canvas");
    await expect(renderedCanvas).toBeVisible();
    await expect(page.getByTestId("access-explorer-nodes-count")).toContainText("6");
    await expect(page.getByTestId("access-explorer-relationships-count")).toContainText("5");
    await expect(page.getByTestId("access-explorer-relation-types-count")).toContainText("4");
    await expect(page.getByText("Access Summary")).toBeVisible();
    await expect(page.getByText(/Sri Aradhyula can access 4 resources across 4 types/)).toBeVisible();
    await expect(renderedCanvas.getByText("GitHub Agent")).toBeVisible();
    await expect(renderedCanvas.getByText("Payments MCP")).toBeVisible();
    await expect(renderedCanvas.getByText("#ops-alerts")).toBeVisible();
    await expect(page.getByTitle("Hide Agents")).toBeVisible();
    await expect(page.getByTitle("Hide MCP Servers")).toBeVisible();
    await expect(page.getByTitle("Hide Slack Channels")).toBeVisible();
  });

  test("renders selected resources as relationship-centered graph scopes", async ({ page }) => {
    const harness = await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);

    await page.getByPlaceholder(accessExplorerPlaceholder).fill("sri");
    await expect(page.getByText("Sri Review Skill")).toBeVisible();
    await page.getByText("Sri Review Skill").click();
    await expect(page.getByText("skill:skill-sri-review")).toBeVisible();
    await page.getByRole("button", { name: "Check Access" }).click();

    await expect
      .poll(() =>
        harness.graphRequests.some((request) =>
          request.subject === "" &&
          request.resourceType === "skill" &&
          request.resourceId === "skill-sri-review",
        ),
      )
      .toBe(true);
    await expect(page.getByRole("tab", { name: "Relationships" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Feature Check" })).toHaveCount(0);
    await expect(page.getByTestId("openfga-graph-canvas")).toBeVisible();
    await expect(page.getByTestId("rf__node-skill:skill-sri-review").getByText("Sri Review Skill")).toBeVisible();
  });

  test("keeps selected resources visible when no relationships exist", async ({ page }) => {
    const harness = await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);

    await page.getByPlaceholder(accessExplorerPlaceholder).fill("empty");
    await expect(page.getByText("Foo Empty Skill")).toBeVisible();
    await page.getByText("Foo Empty Skill").click();
    await expect(page.getByText("skill:skill-empty")).toBeVisible();
    await page.getByRole("button", { name: "Check Access" }).click();

    await expect
      .poll(() =>
        harness.graphRequests.some((request) =>
          request.subject === "" &&
          request.resourceType === "skill" &&
          request.resourceId === "skill-empty",
        ),
      )
      .toBe(true);
    await expect(page.getByRole("tab", { name: "Relationships" })).toBeVisible();
    await expect(page.getByTestId("openfga-graph-canvas")).toBeVisible();
    await expect(page.getByTestId("access-explorer-nodes-count")).toContainText("1");
    await expect(page.getByTestId("access-explorer-relationships-count")).toContainText("0");
    await expect(page.getByTestId("access-explorer-relation-types-count")).toContainText("0");
    await expect(page.getByTestId("rf__node-skill:skill-empty").getByText("Foo Empty Skill")).toBeVisible();
  });

  test("keeps selected actor and agent visible when no feature grant exists", async ({ page }) => {
    const harness = await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);

    await page.getByPlaceholder(accessExplorerPlaceholder).fill("sri");
    await page.getByText("Sri Assistant Agent").click();
    await expect(page.getByText("agent:agent-sri-assistant")).toBeVisible();

    const principalPicker = page.getByTestId("access-explorer-principal-picker");
    await principalPicker
      .getByPlaceholder("Search team, user, service account, or unlinked service account...")
      .fill("sri");
    await expect(principalPicker.getByText("Sri Aradhyula")).toBeVisible();
    await principalPicker.getByText("Sri Aradhyula").click();
    await expect(page.getByText("user:user-sri")).toBeVisible();
    await page.getByRole("button", { name: "Check Access" }).click();

    await expect
      .poll(() =>
        harness.graphRequests.some((request) =>
          request.subject === "user:user-sri" &&
          request.resourceType === "agent" &&
          request.resourceId === "agent-sri-assistant",
        ),
      )
      .toBe(true);
    await expect(page.getByRole("tab", { name: "Feature Check" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Sri Aradhyula is blocked at: Actor can invoke agent.")).toBeVisible();
    await expect(page.getByText("user:user-sri can_use agent:agent-sri-assistant").first()).toBeVisible();
    await page.getByRole("tab", { name: "Relationships" }).click();
    await expect(page.getByTestId("access-explorer-nodes-count")).toContainText("2");
    await expect(page.getByTestId("access-explorer-relationships-count")).toContainText("0");
    await expect(page.getByTestId("rf__node-user:user-sri").getByText("Sri Aradhyula")).toBeVisible();
    await expect(
      page.getByTestId("rf__node-agent:agent-sri-assistant").getByText("Sri Assistant Agent"),
    ).toBeVisible();
    await expect(page.getByText("No OpenFGA relationship found for the selected actor and agent.")).toBeVisible();
  });

  test("renders selected data sources with a data_source graph scope", async ({ page }) => {
    const harness = await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);

    await page.getByPlaceholder(accessExplorerPlaceholder).fill("sri");
    await expect(page.getByText("Sri Runbooks")).toBeVisible();
    await page.getByText("Sri Runbooks").click();
    await expect(page.getByText("data_source:kb-sri-runbooks")).toBeVisible();
    await page.getByRole("button", { name: "Check Access" }).click();

    await expect
      .poll(() =>
        harness.graphRequests.some((request) =>
          request.subject === "" &&
          request.resourceType === "data_source" &&
          request.resourceId === "kb-sri-runbooks",
        ),
      )
      .toBe(true);
    await expect(page.getByRole("tab", { name: "Relationships" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Feature Check" })).toHaveCount(0);
    await expect(page.getByTestId("openfga-graph-canvas")).toBeVisible();
    await expect(page.getByTestId("rf__node-data_source:kb-sri-runbooks").getByText("Sri Runbooks")).toBeVisible();
  });

  test("lets an agent be explored as a team, user, service account, or unlinked service account", async ({
    page,
  }) => {
    const harness = await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);

    await page
      .getByPlaceholder(accessExplorerPlaceholder)
      .fill("sri");
    await page.getByText("Sri Assistant Agent").click();
    await expect(page.getByText("agent:agent-sri-assistant")).toBeVisible();
    const principalPicker = page.getByTestId("access-explorer-principal-picker");
    await expect(principalPicker).toBeVisible();

    await principalPicker
      .getByPlaceholder("Search team, user, service account, or unlinked service account...")
      .fill("platform");
    await expect(principalPicker.getByText("Platform Team")).toBeVisible();
    await principalPicker.getByText("Platform Team").click();
    await expect(page.getByText("team:platform")).toBeVisible();
    await page.getByRole("button", { name: "Check Access" }).click();

    await expect
      .poll(() =>
        harness.graphRequests.some((request) =>
          request.subject === "team:platform" &&
          request.resourceType === "agent" &&
          request.resourceId === "agent-sri-assistant",
        ),
      )
      .toBe(true);

    await principalPicker.getByRole("button").click();
    await principalPicker
      .getByPlaceholder("Search team, user, service account, or unlinked service account...")
      .fill("unlinked");
    await expect(principalPicker.getByText("unlinked", { exact: true })).toBeVisible();
    await principalPicker.getByText("unlinked", { exact: true }).click();
    await expect(page.getByText("service_account:sa-unlinked")).toBeVisible();
    await page.getByRole("button", { name: "Check Access" }).click();

    await expect
      .poll(() =>
        harness.graphRequests.some((request) =>
          request.subject === "service_account:sa-unlinked" &&
          request.resourceType === "agent" &&
          request.resourceId === "agent-sri-assistant",
        ),
      )
      .toBe(true);
  });

  test("filters resource types client-side and keeps filters available in fullscreen", async ({
    page,
  }) => {
    const harness = await installAccessExplorerMocks(page);
    await gotoAccessExplorer(page);
    await selectSriAndCheckAccess(page);

    await page.getByRole("tab", { name: "Relationships" }).click();
    const canvas = page.getByTestId("openfga-graph-canvas");
    await expect(canvas.getByText("GitHub Agent")).toBeVisible();
    await expect(canvas.getByText("Payments MCP")).toBeVisible();
    await expect(canvas.getByText("#ops-alerts")).toBeVisible();

    await page.getByTitle("Hide MCP Servers").click();
    await expect(canvas.getByText("Payments MCP")).toHaveCount(0);
    await expect(canvas.getByText("GitHub Agent")).toBeVisible();
    await expect.poll(() => harness.graphSubjects.includes("user:user-sri")).toBe(true);

    await page.getByTitle("Show MCP Servers").click();
    await expect(canvas.getByText("Payments MCP")).toBeVisible();

    await page.getByTitle("Full screen").click();
    const dialog = page.getByRole("dialog", { name: "Access Explorer" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Relationships" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText("Filter by type")).toBeVisible();
    await expect(dialog.getByTitle("Hide Agents")).toBeVisible();
    await expect(dialog.getByTitle("Hide MCP Servers")).toBeVisible();
    await expect(dialog.getByTitle("Hide Slack Channels")).toBeVisible();

    const fullscreenCanvas = dialog.locator('[data-testid="openfga-graph-canvas"]');
    await expect(fullscreenCanvas.getByText("#ops-alerts")).toBeVisible();
    await dialog.getByTitle("Hide Slack Channels").click();
    await expect(fullscreenCanvas.getByText("#ops-alerts")).toHaveCount(0);
    await expect(fullscreenCanvas.getByText("GitHub Agent")).toBeVisible();
    await expect.poll(() => harness.graphSubjects.includes("user:user-sri")).toBe(true);

    await dialog.getByRole("button", { name: "Exit full screen" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("tab", { name: "Feature Check" }).click();
    await page.getByTitle("Full screen").click();
    const featureDialog = page.getByRole("dialog", { name: "Access Explorer" });
    await expect(featureDialog).toBeVisible();
    await expect(featureDialog.getByRole("tab", { name: "Feature Check" })).toHaveAttribute("aria-selected", "true");
    await expect(featureDialog.getByTestId("feature-check-panel")).toBeVisible();
    await featureDialog.getByRole("button", { name: "Exit full screen" }).click();
    await expect(featureDialog).toHaveCount(0);
  });
});
