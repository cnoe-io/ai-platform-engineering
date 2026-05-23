import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { signIn } from "./_helpers";

test.describe("RBAC e2e — PDP unavailable (503)", () => {
  test("when Keycloak is unreachable, a 503 toast surfaces (not a silent allow)", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip();

    // Operator must temporarily make Keycloak unreachable from the
    // supervisor / DA pods before invoking this test (e.g. by setting
    // OIDC_TOKEN_ENDPOINT to a black-hole URL via docker-compose env
    // override). We do NOT mutate the live stack from inside the
    // browser — that would be wildly fragile.
    test.skip(
      process.env.RBAC_E2E_PDP_DOWN_BREAK_KC !== "1",
      "Set RBAC_E2E_PDP_DOWN_BREAK_KC=1 once Keycloak has been " +
        "made unreachable for this test run. See ui/e2e/rbac/README.md.",
    );

    await signIn(page, env);
    await page.goto("/chat");

    await page.getByRole("textbox").fill("hello");
    await page.keyboard.press("Enter");

    const toast = page
      .getByRole("status")
      .filter({ hasText: /try again|temporarily|unavailable|503/i });
    await expect(toast).toBeVisible({ timeout: 15_000 });
  });
});
