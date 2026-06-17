// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";

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

const agents = [
  {
    _id: "agent-incident",
    name: "Incident Commander",
    ui: {
      avatar: {
        type: "icon",
        icon: "bot",
        bgColor: "#0f766e",
        textColor: "#ffffff",
      },
    },
  },
  {
    _id: "agent-finops",
    name: "FinOps Analyst",
  },
];

const conversations = [
  {
    id: "conv-slack-incident",
    title: "Slack incident bridge",
    owner_id: "slack-user@example.com",
    agent_id: "agent-incident",
    created_at: "2026-06-15T13:20:00.000Z",
    updated_at: "2026-06-16T18:30:00.000Z",
    checkpoint_count: 7,
    file_count: 2,
    client_type: "slack",
    idempotency_key: "slack:T123:C456:1718562600.000000",
    metadata: {
      workspace_url: "https://example.slack.com",
      channel_id: "C456",
      channel_name: "incidents",
      thread_ts: "1718562600.000000",
    },
    is_archived: false,
    deleted_at: null,
  },
  {
    id: "conv-web-finops",
    title: "Web cost review",
    owner_id: adminSession.email,
    agent_id: "agent-finops",
    created_at: "2026-06-14T12:00:00.000Z",
    updated_at: "2026-06-16T16:00:00.000Z",
    checkpoint_count: 3,
    message_count: 8,
    file_count: 0,
    client_type: "webui",
    is_archived: false,
    deleted_at: null,
  },
  {
    id: "conv-archived",
    title: "Archived audit trail",
    owner_id: "ops@example.com",
    agent_id: "agent-incident",
    created_at: "2026-06-10T09:00:00.000Z",
    updated_at: "2026-06-11T09:00:00.000Z",
    checkpoint_count: 1,
    file_count: 0,
    client_type: "webui",
    is_archived: true,
    deleted_at: null,
  },
];

function paginated(items: unknown[], total = items.length, page = 1, pageSize = 10) {
  return {
    success: true,
    data: {
      items,
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    },
  };
}

function installConversationRoutes(options: {
  denyConversations?: boolean;
  onConversationRequest?: (url: URL) => void;
  onDeleteRequest?: (conversationId: string) => void;
} = {}): MockRouteHandler {
  return async ({ route, path, method, url }) => {
    if (path === "/api/dynamic-agents" && method === "GET") {
      await fulfillJson(route, paginated(agents, agents.length, 1, 100));
      return true;
    }

    if (path === "/api/dynamic-agents/conversations" && method === "GET") {
      options.onConversationRequest?.(url);
      if (options.denyConversations) {
        await fulfillJson(
          route,
          {
            success: false,
            error: "You do not have permission to access this resource.",
            code: "audit_log#read",
          },
          403,
        );
        return true;
      }

      const search = url.searchParams.get("search")?.trim().toLowerCase();
      const agentId = url.searchParams.get("agent_id")?.trim();
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("page_size") ?? "10");
      let filtered = conversations;

      if (search) {
        filtered = filtered.filter((conversation) =>
          [conversation.id, conversation.title, conversation.owner_id].some((value) =>
            value.toLowerCase().includes(search),
          ),
        );
      }

      if (agentId) {
        filtered = filtered.filter((conversation) => conversation.agent_id === agentId);
      }

      const start = (page - 1) * pageSize;
      await fulfillJson(route, paginated(filtered.slice(start, start + pageSize), filtered.length, page, pageSize));
      return true;
    }

    if (path.startsWith("/api/admin/audit-logs/") && method === "DELETE") {
      options.onDeleteRequest?.(decodeURIComponent(path.split("/").pop() ?? ""));
      await fulfillJson(route, { success: true });
      return true;
    }

    return false;
  };
}

test.describe("mocked RBAC Dynamic Agent conversations", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("superadmin can open and manage the Conversations tab without a permission error", async ({
    page,
  }) => {
    const conversationRequests: URL[] = [];
    const deleteRequests: string[] = [];

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { audit_logs: true },
      handlers: [
        installConversationRoutes({
          onConversationRequest: (url) => conversationRequests.push(new URL(url.toString())),
          onDeleteRequest: (conversationId) => deleteRequests.push(conversationId),
        }),
      ],
    });

    await page.goto("/dynamic-agents?tab=conversations", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/dynamic-agents\?tab=conversations/);
    await expect(page.getByRole("tab", { name: "Conversations" })).toHaveAttribute("data-state", "active");
    await expect(page.getByText("View and manage Dynamic Agent conversations.")).toBeVisible();
    await expect(page.getByText("You do not have permission to access this resource.")).toHaveCount(0);
    await expect(page.getByText("3 conversations found")).toBeVisible();

    await expect(page.getByText("Slack incident bridge")).toBeVisible();
    await expect(page.getByText("Incident Commander")).toHaveCount(3);
    await expect(page.getByText("Slack", { exact: true })).toBeVisible();
    await expect(page.getByText("Web cost review")).toBeVisible();
    await expect(page.getByText("FinOps Analyst")).toHaveCount(2);
    await expect(page.getByText("Archived audit trail")).toBeVisible();
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    await page.getByText("Slack incident bridge").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Slack incident bridge" })).toBeVisible();
    await expect(dialog.getByText("conv-slack-incident")).toBeVisible();
    await expect(dialog.getByText("slack-user@example.com")).toBeVisible();
    await expect(dialog.getByText("Incident Commander")).toBeVisible();
    await expect(dialog.getByText("View Slack thread")).toHaveAttribute(
      "href",
      "https://example.slack.com/archives/C456/p1718562600000000",
    );
    await expect(dialog.getByText("Checkpoints")).toBeVisible();
    await expect(dialog.getByText("Files")).toBeVisible();

    page.once("dialog", async (nativeDialog) => {
      expect(nativeDialog.message()).toContain("permanently remove");
      await nativeDialog.accept();
    });
    await dialog.getByRole("button", { name: "Delete All" }).click();
    await expect.poll(() => deleteRequests).toEqual(["conv-slack-incident"]);

    await expect.poll(() => conversationRequests.length).toBeGreaterThanOrEqual(2);
    expect(conversationRequests[0].searchParams.get("page")).toBe("1");
    expect(conversationRequests[0].searchParams.get("page_size")).toBe("10");
  });

  test("search, agent filter, refresh, and page size use the Conversations API parameters", async ({
    page,
  }) => {
    const conversationRequests: URL[] = [];

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { audit_logs: true },
      handlers: [
        installConversationRoutes({
          onConversationRequest: (url) => conversationRequests.push(new URL(url.toString())),
        }),
      ],
    });

    await page.goto("/dynamic-agents?tab=conversations", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("3 conversations found")).toBeVisible();

    await page.getByPlaceholder("Search by ID, title, or owner...").fill("cost");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("1 conversation found")).toBeVisible();
    await expect(page.getByText("Web cost review")).toBeVisible();
    await expect(page.getByText("Slack incident bridge")).toHaveCount(0);

    const agentSelect = page.locator("select").first();
    await agentSelect.selectOption("agent-finops");
    await expect(page.getByText("1 conversation found")).toBeVisible();

    const rowsSelect = page.locator("label", { hasText: "Rows" }).locator("..").locator("select");
    await rowsSelect.selectOption("20");
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => conversationRequests.length).toBeGreaterThanOrEqual(5);

    const lastRequest = conversationRequests.at(-1);
    expect(lastRequest?.searchParams.get("search")).toBe("cost");
    expect(lastRequest?.searchParams.get("agent_id")).toBe("agent-finops");
    expect(lastRequest?.searchParams.get("page")).toBe("1");
    expect(lastRequest?.searchParams.get("page_size")).toBe("20");
  });

  test("non-authorized audit response still renders the explicit permission error and retry path", async ({
    page,
  }) => {
    let requests = 0;

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { audit_logs: true },
      handlers: [
        installConversationRoutes({
          denyConversations: true,
          onConversationRequest: () => {
            requests += 1;
          },
        }),
      ],
    });

    await page.goto("/dynamic-agents?tab=conversations", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("You do not have permission to access this resource.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText("Slack incident bridge")).toHaveCount(0);

    await page.unroute("**/api/**");
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { audit_logs: true },
      handlers: [
        async ({ route, path, method }) => {
          if (path === "/api/dynamic-agents" && method === "GET") {
            await fulfillJson(route, paginated(agents, agents.length, 1, 100));
            return true;
          }
          if (path === "/api/dynamic-agents/conversations" && method === "GET") {
            requests += 1;
            await fulfillJson(route, paginated([conversations[0]]));
            return true;
          }
          return false;
        },
      ],
    });
    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByText("You do not have permission to access this resource.")).toHaveCount(0);
    await expect(page.getByText("Slack incident bridge")).toBeVisible();
    await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  });

  test("hides the Conversations tab when the audit logs gate is disabled", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { audit_logs: false },
      handlers: [installConversationRoutes()],
    });

    await page.goto("/dynamic-agents?tab=conversations", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("tab", { name: "Conversations" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Agents" })).toHaveAttribute("data-state", "active");
    await expect(page.getByText("View and manage Dynamic Agent conversations.")).toHaveCount(0);
  });
});
