import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { expectChatComposerReady, installChatBootMocks, signIn } from "./_helpers";

test.describe("RBAC e2e — conversation source filtering", () => {
  test("the authenticated UI requests only webui conversations", async ({ page }) => {
    const env = rbacEnvOrSkip();
    let capturedClientType: string | null = null;
    let conversationRequests = 0;

    await installChatBootMocks(page, env, {
      onConversationListRequest: (requestUrl) => {
      conversationRequests += 1;
      capturedClientType = requestUrl.searchParams.get("client_type");
      },
    });

    await signIn(page, env);
    await page.goto("/chat");

    await expect(page).toHaveURL(/\/chat/);
    await expectChatComposerReady(page);
    await expect.poll(() => conversationRequests).toBeGreaterThan(0);
    await expect.poll(() => capturedClientType).toBe("webui");
  });
});
