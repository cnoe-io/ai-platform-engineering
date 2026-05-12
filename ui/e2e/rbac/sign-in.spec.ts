import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { signIn } from "./_helpers";

test.describe("RBAC e2e — sign-in", () => {
  test("a user with the chat_user role can reach the chat page", async ({ page }) => {
    const env = rbacEnvOrSkip();
    await signIn(page, env);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat/);
    // The chat composer textarea is the canonical "I'm in" signal.
    await expect(page.getByRole("textbox")).toBeVisible({ timeout: 30_000 });
  });
});
