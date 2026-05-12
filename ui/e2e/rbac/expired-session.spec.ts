import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { signIn, expireSession } from "./_helpers";

test.describe("RBAC e2e — expired session", () => {
  test("an expired session shows the auth error toast and not a 500", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip();
    await signIn(page, env);
    await page.goto("/chat");

    await expireSession(page);

    // Submitting a chat message after expiry should surface the
    // standardized 401 toast (from Spec 102 Phase 7 — UI auth errors)
    // and NOT a generic "Failed to fetch" / "HTTP 500".
    await page.getByRole("textbox").fill("hello");
    await page.keyboard.press("Enter");

    const toast = page.getByRole("status").filter({ hasText: /sign in|session/i });
    await expect(toast).toBeVisible({ timeout: 15_000 });
  });
});
