import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { signIn } from "./_helpers";

test.describe("RBAC e2e — conversation source filtering", () => {
  test("the authenticated UI requests only webui conversations", async ({ page }) => {
    const env = rbacEnvOrSkip();
    let capturedClientType: string | null = null;
    let conversationRequests = 0;

    await page.route("**/api/chat/conversations**", async (route) => {
      const requestUrl = new URL(route.request().url());

      if (requestUrl.pathname !== "/api/chat/conversations") {
        await route.continue();
        return;
      }

      conversationRequests += 1;
      capturedClientType = requestUrl.searchParams.get("client_type");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [],
            total: 0,
            page: 1,
            page_size: 100,
            has_more: false,
          },
        }),
      });
    });

    await signIn(page, env);
    await page.goto("/chat");

    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByRole("textbox")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => conversationRequests).toBeGreaterThan(0);
    await expect.poll(() => capturedClientType).toBe("webui");
  });
});
