import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { signIn } from "./_helpers";

test.describe("RBAC e2e — missing role (403)", () => {
  test("user without chat_user role gets a 403 toast on chat submit", async ({
    page,
  }) => {
    const env = rbacEnvOrSkip();
    await signIn(page, env, env.noAccess);

    await page.goto("/chat");
    await page.getByRole("textbox").fill("hello");
    await page.keyboard.press("Enter");

    const toast = page
      .getByRole("status")
      .filter({ hasText: /access|permission|forbidden|admin/i });
    await expect(toast).toBeVisible({ timeout: 15_000 });
  });
});
