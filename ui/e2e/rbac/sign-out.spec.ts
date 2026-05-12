import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { signIn, signOut } from "./_helpers";

test.describe("RBAC e2e — sign-out", () => {
  test("after sign-out, accessing /chat redirects to Keycloak login", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip();
    await signIn(page, env);
    await signOut(page, env);
    await page.goto("/chat");
    await expect(page).toHaveURL((u) => u.toString().includes(env.keycloakUrl), {
      timeout: 30_000,
    });
  });
});
