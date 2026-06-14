// assisted-by Codex Codex-sonnet-4-6
/**
 * Shared helpers for the RBAC e2e suite.
 */

import { encode } from "next-auth/jwt";
import { Page, expect } from "@playwright/test";
import type { RbacEnv } from "./_env";

type TestSessionInput = {
  email: string;
  subject: string;
  role?: "admin" | "user";
};

type TestCredentials = {
  email: string;
  password: string;
  sub?: string;
};

type ChatBootMocksOptions = {
  conversationId?: string;
  ownerEmail?: string;
  onConversationListRequest?: (url: URL) => void;
};

function chatConversationFixture(id: string, ownerEmail: string) {
  const now = new Date().toISOString();
  return {
    _id: id,
    title: "RBAC E2E Conversation",
    client_type: "webui",
    owner_id: ownerEmail,
    participants: [],
    created_at: now,
    updated_at: now,
    metadata: { client_type: "webui", total_messages: 0 },
    sharing: {
      is_public: false,
      shared_with: [],
      shared_with_teams: [],
      share_link_enabled: false,
    },
    tags: [],
    is_archived: false,
    is_pinned: false,
    deleted_at: null,
  };
}

export async function installChatBootMocks(
  page: Page,
  env: RbacEnv,
  options: ChatBootMocksOptions = {},
): Promise<void> {
  const conversationId = options.conversationId ?? "rbac-e2e-conversation";
  const ownerEmail = options.ownerEmail ?? env.user.email;
  const conversation = chatConversationFixture(conversationId, ownerEmail);
  let created = false;

  await page.route("**/api/admin/platform-config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { default_agent_id: null } }),
    });
  });

  await page.route("**/api/chat/conversations**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const method = request.method();
    const path = requestUrl.pathname;

    if (path === "/api/chat/conversations" && method === "GET") {
      options.onConversationListRequest?.(requestUrl);
      const items = created ? [conversation] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items,
            total: items.length,
            page: 1,
            page_size: 100,
            has_more: false,
          },
        }),
      });
      return;
    }

    if (path === "/api/chat/conversations" && method === "POST") {
      created = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { conversation, created: true },
        }),
      });
      return;
    }

    if (path === `/api/chat/conversations/${conversationId}` && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: conversation }),
      });
      return;
    }

    if (
      (path === `/api/chat/conversations/${conversationId}/turns` ||
        path === `/api/chat/conversations/${conversationId}/messages`) &&
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
}

export async function dismissReleaseUpgradeDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /what's new/i });
  if (!(await dialog.isVisible({ timeout: 3_000 }).catch(() => false))) return;

  await page.keyboard.press("Escape").catch(() => undefined);
  if (await dialog.isHidden({ timeout: 1_000 }).catch(() => false)) return;

  const closeButton = dialog.getByRole("button", { name: /^close$/i });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true });
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    return;
  }

  const skipButton = dialog.getByRole("button", { name: /skip until next login|do not show again/i });
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click({ force: true });
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  }
}

export async function expectChatComposerReady(
  page: Page,
  timeoutMs = 30_000,
): Promise<void> {
  const textbox = page.getByRole("textbox");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await dismissReleaseUpgradeDialog(page);
    if (await textbox.isVisible({ timeout: 500 }).catch(() => false)) {
      await expect(textbox).toBeVisible();
      return;
    }
    await page.waitForTimeout(250);
  }

  await dismissReleaseUpgradeDialog(page);
  await expect(textbox).toBeVisible({ timeout: 1_000 });
}

/** Sign in by visiting the home page and walking the NextAuth -> Keycloak flow. */
export async function signIn(
  page: Page,
  env: RbacEnv,
  creds: TestCredentials = env.user,
): Promise<void> {
  if (
    typeof creds.sub === "string" &&
    creds.sub.length > 0 &&
    process.env.NEXTAUTH_SECRET
  ) {
    await installTestSession(page, env, {
      email: creds.email,
      subject: creds.sub,
      role: creds.email === env.user.email ? "admin" : "user",
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);
    await expect(page).toHaveURL(new RegExp(`^${env.baseUrl}`));
    return;
  }

  await page.goto("/");
  // Some stacks redirect unauthenticated users straight to Keycloak, while
  // others first land on the local /login page and wait for the user to
  // click the SSO button.
  await page.waitForURL(
    (u) =>
      u.toString().includes(env.keycloakUrl) ||
      u.toString().startsWith(env.baseUrl + "/login"),
    { timeout: 30_000 },
  );

  if (page.url().startsWith(env.baseUrl + "/login")) {
    await Promise.all([
      page.waitForURL((u) => u.toString().includes(env.keycloakUrl), {
        timeout: 30_000,
      }),
      page.getByRole("button", { name: /sign in with sso/i }).click(),
    ]);
  } else {
    await page.waitForURL((u) => u.toString().includes(env.keycloakUrl), {
      timeout: 30_000,
    });
  }

  await page.fill('input[name="username"], input[name="email"]', creds.email);
  await page.fill('input[name="password"]', creds.password);
  await Promise.all([
    page.waitForURL((u) => u.toString().startsWith(env.baseUrl), {
      timeout: 45_000,
    }),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);

  await expect(page).toHaveURL(new RegExp(`^${env.baseUrl}`));
}

/**
 * Install a real NextAuth JWT session cookie without walking the interactive
 * OIDC browser flow. Local dev realms often force Duo via `OIDC_IDP_HINT`,
 * which is unsuitable for deterministic headless regressions; the BFF still
 * decodes this cookie through the same NextAuth JWT path as normal sessions.
 */
export async function installTestSession(
  page: Page,
  env: RbacEnv,
  input: TestSessionInput,
): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required to mint the RBAC e2e session cookie");
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = await encode({
    secret,
    maxAge: 60 * 60,
    token: {
      sub: input.subject,
      name: input.email,
      email: input.email,
      accessToken: "rbac-e2e-local-access-token",
      expiresAt,
      isAuthorized: true,
      role: input.role ?? "admin",
      canViewAdmin: true,
      canAccessDynamicAgents: true,
      org: process.env.CAIPE_ORG_KEY?.trim() || "caipe",
    },
  });

  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      url: env.baseUrl,
      httpOnly: true,
      sameSite: "Lax",
      expires: expiresAt,
    },
  ]);
}

/** Click the user menu and select "Sign out". */
export async function signOut(page: Page, env: RbacEnv): Promise<void> {
  await dismissReleaseUpgradeDialog(page);
  await page.getByRole("button", { name: /account|menu|profile/i }).click();
  await Promise.all([
    page.waitForURL(
      (u) =>
        u.toString().startsWith(`${env.baseUrl}/login`) ||
        u.toString().includes(env.keycloakUrl) ||
        u.hostname.endsWith("duosecurity.com"),
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: /sign out|log out/i }).click({ force: true }),
  ]);
}

/** Forge a session cookie expiry by setting the NextAuth cookie's maxAge to 0. */
export async function expireSession(page: Page): Promise<void> {
  const cookies = await page.context().cookies();
  const sessionCookies = cookies.filter((c) =>
    /next-auth\.session-token|__Secure-next-auth\.session-token/.test(c.name),
  );
  for (const c of sessionCookies) {
    await page.context().addCookies([
      { ...c, expires: Math.floor(Date.now() / 1000) - 60 },
    ]);
  }
}
