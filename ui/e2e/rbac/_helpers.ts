/**
 * Shared helpers for the RBAC e2e suite.
 */

import { Page, expect } from "@playwright/test";
import type { RbacEnv } from "./_env";

/** Sign in by visiting the home page and walking the NextAuth -> Keycloak flow. */
export async function signIn(
  page: Page,
  env: RbacEnv,
  creds: { email: string; password: string } = env.user,
): Promise<void> {
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

/** Click the user menu and select "Sign out". */
export async function signOut(page: Page, env: RbacEnv): Promise<void> {
  await page.getByRole("button", { name: /account|menu|profile/i }).click();
  await page.getByRole("menuitem", { name: /sign out|log out/i }).click();
  await page.waitForURL((u) => !u.toString().startsWith(env.baseUrl + "/chat"));
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
