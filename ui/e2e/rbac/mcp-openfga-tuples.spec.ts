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

type InstalledRagFileMocks = {
  uploadRequests: Array<{
    contentType: string;
    body: string;
  }>;
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

async function installKnowledgeBaseMcpMocks(page: Page): Promise<void> {
  await installMockedRbacApp(page, {
    isAdmin: true,
    session: adminSession,
    handlers: [
      async ({ route, path, method }) => {
        if (path === "/api/mcp-servers" && method === "GET") {
          await fulfillJson(route, {
            success: true,
            data: {
              items: [
                {
                  _id: "mcp-knowledge-base",
                  name: "knowledge-base",
                  description: "Knowledge Base RAG MCP",
                  transport: "http",
                  endpoint: "http://agentgateway:8080/mcp/knowledge-base",
                  enabled: true,
                  config_driven: false,
                  source: "agentgateway",
                  agentgateway_target_endpoint: "http://rag-server:8000/mcp",
                },
              ],
              total: 1,
              page: 1,
              page_size: 100,
              has_more: false,
            },
          });
          return true;
        }

        return false;
      },
    ],
  });
}

async function installRagFileIngestMocks(page: Page): Promise<InstalledRagFileMocks> {
  const uploadRequests: InstalledRagFileMocks["uploadRequests"] = [];

  await installMockedRbacApp(page, {
    isAdmin: true,
    session: adminSession,
    handlers: [
      async ({ route, path, method }) => {
        if (path === "/api/rbac/kb-tab-gates" && method === "GET") {
          await fulfillJson(route, {
            gates: {
              search: true,
              data_sources: true,
              graph: true,
              mcp_tools: true,
              has_any_kb: true,
              kb_count: 1,
              can_ingest: true,
              can_search: true,
            },
            org_admin_bypass: true,
          });
          return true;
        }

        if (path === "/api/rag/healthz" && method === "GET") {
          await fulfillJson(route, {
            status: "healthy",
            config: { graph_rag_enabled: true },
          });
          return true;
        }

        if (path === "/api/rbac/ingest-teams" && method === "GET") {
          await fulfillJson(route, { org_admin: true, teams: [] });
          return true;
        }

        if (path === "/api/rag/v1/ingestors" && method === "GET") {
          await fulfillJson(route, [
            {
              ingestor_id: "local-file-upload",
              ingestor_type: "local-file",
              ingestor_name: "Local file upload",
              description: "Upload Markdown, text, and PDF files",
            },
            {
              ingestor_id: "webloader:default_webloader",
              ingestor_type: "webloader",
              ingestor_name: "Webloader",
              description: "Web loader",
            },
          ]);
          return true;
        }

        if (path === "/api/rag/v1/datasources" && method === "GET") {
          await fulfillJson(route, { success: true, datasources: [], count: 0 });
          return true;
        }

        if (path === "/api/rag/v1/jobs/batch" && method === "POST") {
          await fulfillJson(route, { jobs: {}, total_jobs: 0, datasource_count: 0 });
          return true;
        }

        if (path === "/api/rag/v1/ingest/local-file" && method === "POST") {
          // assisted-by Codex Codex-sonnet-4-6
          // Keep this assertion at the browser boundary: the regression we care
          // about is that the UI sends multipart FormData, not JSON.
          const contentType = route.request().headers()["content-type"] ?? "";
          const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
          uploadRequests.push({ contentType, body });
          await fulfillJson(route, {
            datasource_id: "local-file-playwright-fixture",
            job_id: "job-local-file-playwright-fixture",
            message: "Accepted local file",
          }, 202);
          return true;
        }

        if (path === "/api/rag/v1/jobs/datasource/local-file-playwright-fixture" && method === "GET") {
          await fulfillJson(route, [
            {
              job_id: "job-local-file-playwright-fixture",
              status: "completed",
              message: "Complete",
              progress_counter: 1,
              failed_counter: 0,
              total: 1,
              created_at: Math.floor(Date.now() / 1000),
            },
          ]);
          return true;
        }

        return false;
      },
    ],
  });

  return { uploadRequests };
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

    await page.getByRole("button", { name: /1\s+MCP/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Agents & MCP", exact: true })).toBeVisible();
    await expect(page.getByText("mcp-confluence-mcp_*")).toBeVisible();

    const putResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        /\/api\/admin\/teams\/[^/]+\/resources$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Save agents and MCP access" }).click();
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

  test("shows AgentGateway-discovered knowledge-base MCP servers in the browser list", async ({
    page,
  }) => {
    await installKnowledgeBaseMcpMocks(page);

    await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("knowledge-base", { exact: true })).toBeVisible();
    await expect(page.getByText("mcp-knowledge-base")).toBeVisible();
    await expect(page.getByTitle("Registered from AgentGateway discovery")).toBeVisible();
    await expect(page.getByText("No MCP Servers Yet")).toHaveCount(0);
  });

  test("uploads local files as multipart FormData from the ingest UI", async ({ page }) => {
    const mocks = await installRagFileIngestMocks(page);

    await page.goto("/knowledge-bases/ingest", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Data Sources", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "File" }).click();
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "playwright-rbac.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# RBAC fixture\n\nUploaded by Playwright.\n"),
    });

    const uploadResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/rag/v1/ingest/local-file",
    );
    await page.getByRole("button", { name: /^Ingest$/ }).click();
    expect((await uploadResponse).status()).toBe(202);

    await expect.poll(() => mocks.uploadRequests.length).toBe(1);
    expect(mocks.uploadRequests[0].contentType).toContain("multipart/form-data");
    expect(mocks.uploadRequests[0].body).toContain('name="file"; filename="playwright-rbac.md"');
    expect(mocks.uploadRequests[0].body).toContain("Uploaded by Playwright.");
    expect(mocks.uploadRequests[0].body).toContain('name="chunk_size"');
    expect(mocks.uploadRequests[0].body).toContain("10000");
    expect(mocks.uploadRequests[0].body).toContain('name="chunk_overlap"');
    expect(mocks.uploadRequests[0].body).toContain("2000");
  });
});
