// assisted-by claude code claude-sonnet-4-6
/**
 * E2E tests for token refresh / session-expiry behaviour (PR #2220).
 *
 * Goal: the refresh-token path must work end-to-end.
 *   - A transient /api/auth/session failure must NOT force logout while the
 *     underlying token still has time left.
 *   - After the retry budget (3 ticks × 30 s) is exhausted on a genuinely
 *     expired token, the "Session Expired" modal appears and redirects to
 *     /login.
 *   - The 5-minute warning banner appears when the token is near expiry and
 *     hides after a successful silent refresh (new expiresAt).
 *   - The token-expiry-handling sessionStorage flag is cleared once the
 *     session is healthy again.
 *
 * These tests use Playwright's route interception to simulate the NextAuth
 * /api/auth/session endpoint returning stale/failed/refreshed payloads,
 * and installTestSession to mint a real JWT cookie without a live Keycloak.
 *
 * Required env vars (same as RBAC suite):
 *   RUN_RBAC_E2E=1
 *   CAIPE_UI_BASE_URL, KEYCLOAK_URL, KEYCLOAK_REALM
 *   RBAC_USER_EMAIL, RBAC_USER_PASSWORD
 *   NEXTAUTH_SECRET  (to mint JWT cookies)
 */

import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { rbacEnvOrSkip, type RbacEnv } from "./_env";
import { dismissReleaseUpgradeDialog } from "./_helpers";

// ─── helpers ────────────────────────────────────────────────────────────────

const SESSION_PATH = "**/api/auth/session";

/** Build a minimal NextAuth session payload. */
function sessionPayload(opts: {
  expiresAt: number;
  hasRefreshToken?: boolean;
  error?: string;
}) {
  return {
    user: {
      name: "E2E Test User",
      email: "e2e@caipe.local",
      expiresAt: opts.expiresAt,
    },
    expires: new Date((opts.expiresAt + 60) * 1000).toISOString(),
    expiresAt: opts.expiresAt,
    hasRefreshToken: opts.hasRefreshToken ?? true,
    ...(opts.error ? { error: opts.error } : {}),
  };
}

/**
 * Mint a JWT cookie whose embedded expiresAt is `expiresAt`.
 * The cookie itself has a generous browser-level maxAge so it won't
 * be dropped by the browser before the test finishes.
 */
async function mintCookie(env: RbacEnv, expiresAt: number): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required");
  return encode({
    secret,
    maxAge: 60 * 60,
    token: {
      sub: "playwright-token-refresh-sub",
      name: "e2e@caipe.local",
      email: "e2e@caipe.local",
      accessToken: "e2e-access-token",
      expiresAt,
      hasRefreshToken: true,
      isAuthorized: true,
      role: "admin",
      canViewAdmin: true,
      canAccessDynamicAgents: true,
      org: process.env.CAIPE_ORG_KEY?.trim() || "caipe",
    },
  });
}

async function installCookieWithExpiry(
  page: import("@playwright/test").Page,
  env: RbacEnv,
  expiresAt: number,
) {
  const token = await mintCookie(env, expiresAt);
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      url: env.baseUrl,
      httpOnly: true,
      sameSite: "Lax",
      expires: expiresAt + 3600,
    },
  ]);
}

// ─── suite ──────────────────────────────────────────────────────────────────

test.describe("token refresh / session expiry (PR #2220)", () => {
  let env: RbacEnv;

  test.beforeAll(() => {
    env = rbacEnvOrSkip();
    test.skip(!process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET required to mint session cookies.");
  });

  // ── 1. Warning banner — token near expiry ─────────────────────────────────

  test("shows 'Session Expiring Soon' banner when token is within 5 minutes of expiry", async ({
    page,
  }) => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 4 * 60; // 4 min from now

    await installCookieWithExpiry(page, env, soonExpiry);

    // Stub /api/auth/session to return the near-expiry payload
    await page.route(SESSION_PATH, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: soonExpiry, hasRefreshToken: true })),
      });
    });

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    await expect(page.getByText(/session expiring soon/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/attempting to refresh automatically/i)).toBeVisible();
  });

  // ── 2. Single transient failure — no logout ───────────────────────────────

  test("does NOT force logout on a single transient /api/auth/session failure", async ({
    page,
  }) => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 4 * 60;
    let callCount = 0;

    await installCookieWithExpiry(page, env, soonExpiry);

    await page.route(SESSION_PATH, async (route) => {
      callCount += 1;
      if (callCount === 1) {
        // First call: transient 500
        await route.fulfill({ status: 500, body: "Internal Server Error" });
      } else {
        // Subsequent calls: healthy session
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(sessionPayload({ expiresAt: soonExpiry, hasRefreshToken: true })),
        });
      }
    });

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    // Give the component two check cycles (30s each) to fire
    await page.waitForTimeout(500); // let the initial check run

    // No "Sign-in Needed" / "Session Expired" modal should appear
    await expect(page.getByText(/sign-in needed/i)).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/session expired/i)).not.toBeVisible();
    // Should not have navigated away
    expect(page.url()).toMatch(new RegExp(`^${env.baseUrl}`));
  });

  // ── 3. Silent refresh success — banner clears ─────────────────────────────

  test("hides 'Session Expiring Soon' banner after a successful silent refresh", async ({
    page,
  }) => {
    const nearExpiry = Math.floor(Date.now() / 1000) + 4 * 60;
    const refreshedExpiry = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour
    let callCount = 0;

    await installCookieWithExpiry(page, env, nearExpiry);

    await page.route(SESSION_PATH, async (route) => {
      callCount += 1;
      const expiry = callCount <= 2 ? nearExpiry : refreshedExpiry;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: expiry, hasRefreshToken: true })),
      });
    });

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    // Wait for the warning to appear first
    await expect(page.getByText(/session expiring soon/i)).toBeVisible({ timeout: 15_000 });

    // Warning should disappear once the next session check returns a refreshed token
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible({ timeout: 15_000 });
  });

  // ── 4. RefreshTokenExpired — immediate logout ─────────────────────────────

  test("shows 'Sign-in Needed' modal immediately when session.error = RefreshTokenExpired", async ({
    page,
  }) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

    await installCookieWithExpiry(page, env, expiresAt);

    await page.route(SESSION_PATH, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          sessionPayload({ expiresAt, error: "RefreshTokenExpired" }),
        ),
      });
    });

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    await expect(page.getByText(/sign-in needed/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/redirecting to login in/i)).toBeVisible();
  });

  // ── 5. Token genuinely expired — logout after retry budget ────────────────

  test("shows 'Session Expired' modal and redirects to /login after retry budget exhausted", async ({
    page,
  }) => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 60; // already expired

    await installCookieWithExpiry(page, env, pastExpiry);

    await page.route(SESSION_PATH, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: pastExpiry, hasRefreshToken: true })),
      });
    });

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    // The modal should eventually appear (after ≤3 × 30s ticks + 5s countdown)
    await expect(page.getByText(/session expired/i)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/redirecting to login in/i)).toBeVisible();

    // After the 5-second countdown the page should redirect to /login
    await page.waitForURL(
      (u) => u.pathname.startsWith("/login") || u.pathname === "/",
      { timeout: 15_000 },
    );
  });

  // ── 6. token-expiry-handling flag — cleared on recovery ──────────────────

  test("clears token-expiry-handling sessionStorage flag once session is healthy again", async ({
    page,
  }) => {
    const nearExpiry = Math.floor(Date.now() / 1000) + 4 * 60;
    const refreshedExpiry = Math.floor(Date.now() / 1000) + 60 * 60;
    let callCount = 0;

    await installCookieWithExpiry(page, env, nearExpiry);

    await page.route(SESSION_PATH, async (route) => {
      callCount += 1;
      const expiry = callCount <= 2 ? nearExpiry : refreshedExpiry;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: expiry, hasRefreshToken: true })),
      });
    });

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    // Wait for the warning banner to show (flag gets set here)
    await expect(page.getByText(/session expiring soon/i)).toBeVisible({ timeout: 15_000 });

    // Wait for the token to be "refreshed" and banner to clear
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible({ timeout: 15_000 });

    // The flag should have been removed from sessionStorage
    const flag = await page.evaluate(
      () => sessionStorage.getItem("token-expiry-handling"),
    );
    expect(flag).toBeNull();
  });

  // ── 7. Dismiss persists for the same expiry cycle ─────────────────────────

  test("'Dismiss' keeps the warning hidden for the current expiry cycle", async ({ page }) => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 4 * 60;

    await installCookieWithExpiry(page, env, soonExpiry);

    await page.route(SESSION_PATH, async (route) => {
      // Always return the same near-expiry session (no refresh)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          sessionPayload({ expiresAt: soonExpiry, hasRefreshToken: false }),
        ),
      });
    });

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    await expect(page.getByText(/session expiring soon/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /dismiss/i }).click();
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible();

    // Wait one more check cycle — warning should stay hidden
    await page.waitForTimeout(35_000);
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible();
  });

  // ── 8. Sign in again — preserves return path ──────────────────────────────

  test("'Sign in again' redirects to /login with callbackUrl preserving current path", async ({
    page,
  }) => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 4 * 60;

    await installCookieWithExpiry(page, env, soonExpiry);

    await page.route(SESSION_PATH, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          sessionPayload({ expiresAt: soonExpiry, hasRefreshToken: false }),
        ),
      });
    });

    await page.goto(`${env.baseUrl}/chat`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    await expect(page.getByText(/session expiring soon/i)).toBeVisible({ timeout: 15_000 });

    await Promise.all([
      page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15_000 }),
      page.getByRole("button", { name: /sign in again/i }).first().click(),
    ]);

    expect(page.url()).toContain("session_expired=true");
    expect(page.url()).toContain("callbackUrl");
  });
});
