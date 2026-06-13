// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Page } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
} from "./_mocked-rbac";

const adminSession = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

const platformTeam = {
  _id: "team-platform",
  name: "Platform Engineering",
  slug: "platform-engineering",
  owner_id: adminSession.email,
  description: "Platform team fixture",
  member_count: 2,
  resources: {
    agents: ["agent-keep"],
    agent_admins: [],
    tools: ["mcp-confluence-mcp_*"],
    tool_wildcard: false,
  },
};

type TeamResourcePutBody = {
  agents?: string[];
  agent_admins?: string[];
  tools?: string[];
  tool_wildcard?: boolean;
};

type InstalledTeamMocks = {
  resourcePutBodies: TeamResourcePutBody[];
};

async function installTeamResourceMocks(page: Page): Promise<InstalledTeamMocks> {
  const resourcePutBodies: TeamResourcePutBody[] = [];

  await installMockedRbacApp(page, {
    isAdmin: true,
    session: adminSession,
    handlers: [
      async ({ route, path, method }) => {
        if (path.startsWith("/api/admin/teams") && method === "GET" && !path.includes("/resources")) {
          await fulfillJson(route, { success: true, data: { teams: [platformTeam] } });
          return true;
        }

        if (method === "GET" && /\/api\/admin\/teams\/[^/]+\/resources$/.test(path)) {
          await fulfillJson(route, {
            success: true,
            data: {
              resources: {
                agents: ["agent-keep"],
                agent_admins: [],
                tools: ["mcp-confluence-mcp_*"],
                tool_wildcard: false,
              },
              available: {
                agents: [{ id: "agent-keep", name: "Keep Agent", description: "" }],
                tools: [
                  {
                    id: "mcp-confluence-mcp_*",
                    name: "mcp-confluence-mcp_*",
                    description: "Confluence MCP",
                  },
                ],
              },
            },
          });
          return true;
        }

        if (method === "PUT" && /\/api\/admin\/teams\/[^/]+\/resources$/.test(path)) {
          resourcePutBodies.push((await postJson(route)) as TeamResourcePutBody);
          await fulfillJson(route, {
            success: true,
            data: {
              members_updated: ["alice@example.com"],
              members_skipped: [],
            },
          });
          return true;
        }

        return false;
      },
    ],
  });

  return { resourcePutBodies };
}

type InstalledMcpMocks = {
  createRequests: Array<Record<string, unknown>>;
  listRequests: number;
};

async function installMcpServerMocks(page: Page): Promise<InstalledMcpMocks> {
  const createRequests: Array<Record<string, unknown>> = [];
  let listRequests = 0;
  let createdServer:
    | {
        _id: string;
        name: string;
        description: string;
        transport: string;
        endpoint: string;
        enabled: boolean;
        config_driven: boolean;
      }
    | null = null;

  await installMockedRbacApp(page, {
    isAdmin: true,
    session: adminSession,
    handlers: [
      async ({ route, path, method }) => {
        if (path === "/api/mcp-servers/agentgateway/discover" && method === "GET") {
          await fulfillJson(route, { success: true, data: { targets: [] } });
          return true;
        }

        if (path === "/api/mcp-servers" && method === "GET") {
          listRequests += 1;
          const items = createdServer ? [createdServer] : [];
          await fulfillJson(route, {
            success: true,
            data: {
              items,
              total: items.length,
              page: 1,
              page_size: 100,
              has_more: false,
            },
          });
          return true;
        }

        if (path === "/api/mcp-servers" && method === "POST") {
          const body = (await postJson(route)) as Record<string, unknown>;
          createRequests.push(body);
          const serverId =
            typeof body.id === "string" && body.id.startsWith("mcp-")
              ? body.id
              : `mcp-${String(body.id ?? "ops-tools")}`;
          createdServer = {
            _id: serverId,
            name: String(body.name ?? "Ops Tools"),
            description: String(body.description ?? ""),
            transport: String(body.transport ?? "sse"),
            endpoint: String(body.endpoint ?? ""),
            enabled: true,
            config_driven: false,
          };
          await fulfillJson(route, { success: true, data: createdServer }, 201);
          return true;
        }

        return false;
      },
    ],
  });

  return {
    get createRequests() {
      return createRequests;
    },
    get listRequests() {
      return listRequests;
    },
  };
}

test.describe("mocked MCP OpenFGA tuple browser regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked MCP OpenFGA browser regression.",
    );
  });

  test("team resources save sends the full selected MCP tool list for drift repair", async ({ page }) => {
    const mocks = await installTeamResourceMocks(page);

    await page.goto("/admin?cat=people&tab=teams", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(platformTeam.name)).toBeVisible();

    await page.getByRole("button", { name: "1 Tools" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resources", exact: true })).toBeVisible();
    await expect(page.getByText("mcp-confluence-mcp_*")).toBeVisible();

    const putResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        /\/api\/admin\/teams\/[^/]+\/resources$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Save resources" }).click();
    await putResponse;

    await expect.poll(() => mocks.resourcePutBodies.length).toBe(1);
    expect(mocks.resourcePutBodies[0]).toEqual({
      agents: ["agent-keep"],
      agent_admins: [],
      tools: ["mcp-confluence-mcp_*"],
      tool_wildcard: false,
    });
  });

  test("created MCP servers remain visible after the list refresh", async ({ page }) => {
    const mocks = await installMcpServerMocks(page);

    await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("No MCP Servers Yet")).toBeVisible();

    await page.getByRole("button", { name: "Add Server" }).first().click();
    await expect(page.getByText("Add MCP Server")).toBeVisible();

    await page.getByLabel(/Server ID/i).fill("ops-tools");
    await page.getByLabel(/Display Name/i).fill("Ops Tools");
    await page.getByLabel(/Endpoint URL/i).fill("https://mcp.example.test/mcp");
    await page.getByRole("button", { name: "Create Server" }).click();

    await expect.poll(() => mocks.createRequests.length).toBe(1);
    expect(mocks.createRequests[0]).toMatchObject({
      id: "ops-tools",
      name: "Ops Tools",
      transport: "sse",
      endpoint: "https://mcp.example.test/mcp",
    });

    await expect(page.getByText("Ops Tools")).toBeVisible();
    await expect.poll(() => mocks.listRequests).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("No MCP Servers Yet")).toHaveCount(0);
  });
});
