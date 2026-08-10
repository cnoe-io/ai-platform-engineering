import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { expectChatComposerReady, installChatBootMocks, signIn } from "./_helpers";

test.describe("chat — auto-create regression", () => {
  test("navigating to /chat with an existing conversation never creates a new one", async ({ page }) => {
    const env = rbacEnvOrSkip();
    let createCallCount = 0;

    await page.route("**/api/chat/conversations", async (route) => {
      if (route.request().method() === "POST") {
        createCallCount++;
      }
      await route.continue();
    });

    await installChatBootMocks(page, env);
    await signIn(page, env);

    // Navigate to /chat three times (simulates clicking the Chat tab repeatedly)
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat\/.+/);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat\/.+/);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat\/.+/);

    await expectChatComposerReady(page);

    expect(createCallCount).toBe(0);
  });

  test("navigating to /chat with no conversations creates exactly one new conversation", async ({ page }) => {
    const env = rbacEnvOrSkip();
    let createCallCount = 0;

    // Override the default mock to return an empty list
    await page.route("**/api/admin/platform-config", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { default_agent_id: null } }),
      });
    });

    await page.route("**/api/chat/conversations**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();

      if (url.pathname === "/api/chat/conversations" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: { items: [], total: 0, page: 1, page_size: 100, has_more: false },
          }),
        });
        return;
      }

      if (url.pathname === "/api/chat/conversations" && method === "POST") {
        createCallCount++;
        const now = new Date().toISOString();
        const id = "new-e2e-conversation";
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              conversation: {
                _id: id,
                title: "New Conversation",
                client_type: "webui",
                owner_id: env.user.email,
                participants: [],
                created_at: now,
                updated_at: now,
                metadata: { client_type: "webui", total_messages: 0 },
                sharing: { is_public: false, shared_with: [], shared_with_teams: [], share_link_enabled: false },
                tags: [],
                is_archived: false,
                is_pinned: false,
                deleted_at: null,
              },
              created: true,
            },
          }),
        });
        return;
      }

      if (url.pathname === "/api/chat/conversations/new-e2e-conversation" && method === "GET") {
        const now = new Date().toISOString();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              _id: "new-e2e-conversation",
              title: "New Conversation",
              client_type: "webui",
              owner_id: env.user.email,
              participants: [],
              created_at: now,
              updated_at: now,
              metadata: { client_type: "webui", total_messages: 0 },
              sharing: { is_public: false, shared_with: [], shared_with_teams: [], share_link_enabled: false },
              tags: [],
              is_archived: false,
              is_pinned: false,
              deleted_at: null,
            },
          }),
        });
        return;
      }

      if (
        (url.pathname === "/api/chat/conversations/new-e2e-conversation/turns" ||
          url.pathname === "/api/chat/conversations/new-e2e-conversation/messages") &&
        method === "GET"
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: { items: [], total: 0, page: 1, page_size: 100, has_more: false },
          }),
        });
        return;
      }

      await route.continue();
    });

    await signIn(page, env);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat\/.+/);
    await expectChatComposerReady(page);

    // Only one conversation should have been created
    expect(createCallCount).toBe(1);
  });
});
