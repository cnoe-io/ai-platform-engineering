import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { expectChatComposerReady, installChatBootMocks, signIn } from "./_helpers";

test.describe("RBAC e2e — sign-in", () => {
  test("a user with the chat_user role can reach the chat page", async ({ page }) => {
    const env = rbacEnvOrSkip();
    await installChatBootMocks(page, env);
    await signIn(page, env);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat/);
    // /chat redirects to /chat/<id>; the composer textarea is the canonical "I'm in" signal.
    await expectChatComposerReady(page);
  });
});
