// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";

import {
  dismissReleaseUpgradeDialog,
  expectChatComposerReady,
  installChatBootMocks,
  installTestSession,
} from "./_helpers";
import { mockedRbacEnabled } from "./_mocked-rbac";

const CHAT_MEMBER_SESSION = {
  email: "member@caipe.local",
  subject: "playwright-chat-member-sub",
};

function minimalSessionEnv() {
  return {
    baseUrl: process.env.CAIPE_UI_BASE_URL ?? "http://localhost:3000",
    keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:7080",
    keycloakRealm: process.env.KEYCLOAK_REALM ?? "caipe",
    user: { email: CHAT_MEMBER_SESSION.email, password: "" },
  };
}

async function bootChatSession(
  page: import("@playwright/test").Page,
  options: Parameters<typeof installChatBootMocks>[2] = {},
) {
  test.skip(!process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET required for chat navigation SSR.");
  const env = minimalSessionEnv();
  await installChatBootMocks(page, env, options);
  await installTestSession(page, env, {
    email: CHAT_MEMBER_SESSION.email,
    subject: CHAT_MEMBER_SESSION.subject,
    role: "user",
  });
  return env;
}

test.describe("mocked RBAC e2e — chat navigation regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked chat navigation regression.",
    );
  });

  test("resumes the existing conversation when /chat is opened repeatedly", async ({ page }) => {
    let createCallCount = 0;
    await page.route("**/api/chat/conversations", async (route) => {
      if (route.request().method() === "POST") {
        createCallCount++;
      }
      await route.continue();
    });

    await bootChatSession(page, { conversationId: "rbac-resume-conv" });

    for (let i = 0; i < 3; i += 1) {
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/chat\/rbac-resume-conv$/);
    }

    await dismissReleaseUpgradeDialog(page);
    await expectChatComposerReady(page);
    expect(createCallCount).toBe(0);
  });

  test("waits for a slow conversation list fetch instead of creating a duplicate chat", async ({
    page,
  }) => {
    let createCallCount = 0;
    let listRequestCount = 0;

    await page.route("**/api/chat/conversations", async (route) => {
      if (route.request().method() === "POST") {
        createCallCount++;
      }
      await route.continue();
    });

    await bootChatSession(page, {
      conversationId: "rbac-slow-list-conv",
      conversationListDelayMs: 400,
      onConversationListRequest: () => {
        listRequestCount += 1;
      },
    });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/chat\/rbac-slow-list-conv$/);
    await expectChatComposerReady(page);

    expect(createCallCount).toBe(0);
    expect(listRequestCount).toBeGreaterThanOrEqual(1);
  });

  test("resumes a persisted last-active conversation id from localStorage", async ({ page }) => {
    const conversationId = "rbac-persisted-conv";
    let createCallCount = 0;

    await page.addInitScript((id: string) => {
      window.localStorage.setItem("caipe-chat-last-active-conversation", id);
    }, conversationId);

    await bootChatSession(page, {
      conversationId,
      onConversationCreate: () => {
        createCallCount += 1;
      },
    });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`));
    expect(createCallCount).toBe(0);
  });

  test("creates exactly one conversation when the server list is empty", async ({ page }) => {
    let createCallCount = 0;

    await page.addInitScript(() => {
      window.localStorage.removeItem("caipe-chat-last-active-conversation");
    });

    await bootChatSession(page, {
      conversationId: "rbac-new-conv",
      seedExistingConversation: false,
      onConversationCreate: () => {
        createCallCount += 1;
      },
    });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/chat\/.+/);
    await expectChatComposerReady(page);

    expect(createCallCount).toBe(1);
  });
});
