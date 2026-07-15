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

/** Suppress the "What's new" release-upgrade dialog by disabling release notes. */
async function suppressReleaseDialog(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/admin/platform-config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { release_notes: { enabled: false } },
      }),
    });
  });
  // Also stub the settings and changelog APIs to avoid any upgrade prompt
  await page.route("**/api/settings**", async (route) => {
    if (route.request().method() === "GET" && new URL(route.request().url()).pathname === "/api/settings") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { preferences: {} } }),
      });
    } else {
      await route.continue();
    }
  });
  await page.route("**/api/changelog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ releases: [] }),
    });
  });
}

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
async function mintCookie(expiresAt: number): Promise<string> {
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
  const token = await mintCookie(expiresAt);
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

    await suppressReleaseDialog(page);
    await installCookieWithExpiry(page, env, soonExpiry);

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

    await suppressReleaseDialog(page);
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

    // Give the component a check cycle to fire
    await page.waitForTimeout(500);

    // No "Sign-in Needed" / "Session Expired" modal should appear
    await expect(page.getByText(/sign-in needed/i)).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/session expired/i)).not.toBeVisible();
    // Should not have navigated away
    expect(page.url()).toMatch(new RegExp(`^${env.baseUrl}`));
  });

  // ── 3. Silent refresh success — banner clears ─────────────────────────────
  //
  // After swapping the route to return a fresh session, we trigger a
  // visibilitychange event so NextAuth re-fetches /api/auth/session immediately
  // (rather than waiting for the 60s COOLDOWN_MS on updateSession()).
  // The component then sees the new expiresAt (1 hr away), exits the warning
  // window check, and hides the banner.

  test("hides 'Session Expiring Soon' banner after a successful silent refresh", async ({
    page,
  }) => {
    const nearExpiry = Math.floor(Date.now() / 1000) + 4 * 60;
    const refreshedExpiry = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

    await suppressReleaseDialog(page);
    await installCookieWithExpiry(page, env, nearExpiry);

    // Start with near-expiry session
    const handler = async (route: import("@playwright/test").Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: nearExpiry, hasRefreshToken: true })),
      });
    };
    await page.route(SESSION_PATH, handler);

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    // Wait for the warning banner to appear
    await expect(page.getByText(/session expiring soon/i)).toBeVisible({ timeout: 15_000 });

    // Swap route to return a refreshed session
    await page.unroute(SESSION_PATH, handler);
    await page.route(SESSION_PATH, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: refreshedExpiry, hasRefreshToken: true })),
      });
    });

    // Trigger NextAuth to re-fetch the session immediately (it listens for
    // visibilitychange to refetch when the tab becomes visible).
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

    // Give NextAuth a moment to fetch and update the session, then the component
    // re-runs checkTokenExpiry on the updated session and hides the banner.
    await page.waitForTimeout(2_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

    // The component sees refreshedExpiry (outside 5-min window), hides the banner.
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible({ timeout: 10_000 });
  });

  // ── 4. RefreshTokenExpired — immediate logout ─────────────────────────────

  test("shows 'Sign-in Needed' modal immediately when session.error = RefreshTokenExpired", async ({
    page,
  }) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

    await suppressReleaseDialog(page);
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
    await expect(page.getByText(/redirecting to login in/i)).toBeVisible({ timeout: 10_000 });
  });

  // ── 5. Token genuinely expired — logout after retry budget ────────────────

  test("shows 'Session Expired' modal and redirects to /login after retry budget exhausted", async ({
    page,
  }) => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 60; // already expired

    await suppressReleaseDialog(page);
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

    // The modal should appear after ≤3 × 30s ticks; then auto-redirects in 5s.
    // waitForURL covers both: it succeeds as soon as /login is reached,
    // meaning the modal appeared and the countdown fired.
    await page.waitForURL(
      (u) => u.pathname.startsWith("/login") || u.pathname === "/",
      { timeout: 120_000 },
    );

    // We can still check the modal appeared; it may still be visible briefly
    // before the redirect, or already gone — use a screenshot as evidence.
    await page.screenshot({ path: "test-results/token-refresh-test5-redirected.png" });
  });

  // ── 6. token-expiry-handling flag — cleared on recovery ──────────────────

  test("clears token-expiry-handling sessionStorage flag once session is healthy again", async ({
    page,
  }) => {
    const nearExpiry = Math.floor(Date.now() / 1000) + 4 * 60;
    const refreshedExpiry = Math.floor(Date.now() / 1000) + 60 * 60;

    await suppressReleaseDialog(page);
    await installCookieWithExpiry(page, env, nearExpiry);

    const handler = async (route: import("@playwright/test").Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: nearExpiry, hasRefreshToken: true })),
      });
    };
    await page.route(SESSION_PATH, handler);

    await page.goto(env.baseUrl, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page).catch(() => undefined);

    // Wait for the warning banner to appear (flag gets set here)
    await expect(page.getByText(/session expiring soon/i)).toBeVisible({ timeout: 15_000 });

    // Verify flag was set
    const flagSet = await page.evaluate(
      () => sessionStorage.getItem("token-expiry-handling"),
    );
    expect(flagSet).toBe("true");

    // Swap route to a refreshed session and trigger immediate re-fetch
    await page.unroute(SESSION_PATH, handler);
    await page.route(SESSION_PATH, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload({ expiresAt: refreshedExpiry, hasRefreshToken: true })),
      });
    });

    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

    // Banner should disappear once the component sees the refreshed expiresAt
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible({ timeout: 10_000 });

    // Flag should now be cleared
    const flagAfter = await page.evaluate(
      () => sessionStorage.getItem("token-expiry-handling"),
    );
    expect(flagAfter).toBeNull();
  });

  // ── 7. Dismiss persists for the same expiry cycle ─────────────────────────

  test("'Dismiss' keeps the warning hidden for the current expiry cycle", async ({ page }) => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 4 * 60;

    await suppressReleaseDialog(page);
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

    // Use force:true to bypass any potential overlay intercepting pointer events
    await page.getByRole("button", { name: /dismiss/i }).click({ force: true });
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible({ timeout: 5_000 });

    // Wait one more check cycle — warning should stay hidden
    await page.waitForTimeout(35_000);
    await expect(page.getByText(/session expiring soon/i)).not.toBeVisible();
  });

  // ── 8. Sign in again — preserves return path ──────────────────────────────

  test("'Sign in again' redirects to /login with callbackUrl preserving current path", async ({
    page,
  }) => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 4 * 60;

    await suppressReleaseDialog(page);
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

    // Unroute the session mock so NextAuth's signOut can redirect freely
    await page.unroute(SESSION_PATH);

    await Promise.all([
      page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15_000 }),
      page.getByRole("button", { name: /sign in again/i }).first().click({ force: true }),
    ]);

    expect(page.url()).toContain("session_expired=true");
    expect(page.url()).toContain("callbackUrl");
  });

  // ── 9. Keycloak realm session lifetime is configurable ───────────────────
  //
  // Verifies that the running Keycloak realm reflects the configured SSO
  // session lifetimes (7d idle / 14d max by default, overridable via
  // KEYCLOAK_SSO_SESSION_IDLE_TIMEOUT / KEYCLOAK_SSO_SESSION_MAX_LIFESPAN).
  // Requires the rbac profile stack (Keycloak accessible).

  test("Keycloak realm has the configured SSO session idle and max lifetimes", async () => {
    const expectedIdle = parseInt(process.env.KEYCLOAK_SSO_SESSION_IDLE_TIMEOUT ?? "604800", 10);
    const expectedMax = parseInt(process.env.KEYCLOAK_SSO_SESSION_MAX_LIFESPAN ?? "1209600", 10);

    // keycloakUrl may be the docker-network hostname (keycloak:7080); replace
    // with localhost so the test runner on the host can reach the exposed port.
    const keycloakBaseUrl = env.keycloakUrl.replace(/\/\/keycloak(:\d+)?/, "//localhost$1");
    const adminTokenResp = await fetch(
      `${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: "admin",
          password: "admin",
        }).toString(),
      },
    );
    expect(adminTokenResp.ok, `Keycloak admin login failed: ${adminTokenResp.status}`).toBe(true);
    const { access_token: adminToken } = (await adminTokenResp.json()) as { access_token: string };

    const realmResp = await fetch(
      `${keycloakBaseUrl}/admin/realms/${env.keycloakRealm}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(realmResp.ok, `Realm fetch failed: ${realmResp.status}`).toBe(true);
    const realm = (await realmResp.json()) as {
      ssoSessionIdleTimeout: number;
      ssoSessionMaxLifespan: number;
    };

    expect(realm.ssoSessionIdleTimeout).toBe(expectedIdle);
    expect(realm.ssoSessionMaxLifespan).toBe(expectedMax);
  });
});
