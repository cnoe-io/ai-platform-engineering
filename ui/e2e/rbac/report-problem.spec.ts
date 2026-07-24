// assisted-by claude claude-sonnet-4-6
/**
 * E2E regression suite for the Report a Problem feature:
 * - Global header button (configurable routing)
 * - AlertTriangle shortcut button next to feedback thumbs
 * - Feedback dialog no longer has inline "Report a Problem" link
 * - REPORT_PROBLEM_ENABLED=false hides all UI
 *
 * Run with:
 *   RUN_REPORT_PROBLEM_E2E=1 \
 *   CAIPE_UI_BASE_URL=http://localhost:3000 \
 *   NEXTAUTH_SECRET=<secret> \
 *   npx playwright test --config=playwright.rbac.config.ts e2e/rbac/report-problem.spec.ts
 */

import { expect, test } from "@playwright/test";

import {
  dismissReleaseUpgradeDialog,
  expectChatComposerReady,
  installChatBootMocks,
  installTestSession,
} from "./_helpers";
import { mockedRbacEnabled } from "./_mocked-rbac";

const E2E_ENABLED =
  process.env.RUN_REPORT_PROBLEM_E2E === "1" || mockedRbacEnabled();

const SESSION = {
  email: "test-user@example.test",
  subject: "playwright-report-problem-sub",
};
const CONV_ID = "report-problem-e2e-conv";
const AGENT_ID = "agent-report-problem-e2e";

function env() {
  return {
    baseUrl: process.env.CAIPE_UI_BASE_URL ?? "http://localhost:3000",
    keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:7080",
    keycloakRealm: process.env.KEYCLOAK_REALM ?? "caipe",
    user: { email: SESSION.email, password: "" },
  };
}

/** One assistant message fixture that satisfies the chat turns API. */
function assistantMessageFixture(convId: string) {
  const now = new Date().toISOString();
  return {
    success: true,
    data: {
      items: [
        {
          id: `${convId}-msg-1`,
          conversation_id: convId,
          role: "user",
          content: "What can you help me with?",
          created_at: now,
          updated_at: now,
        },
        {
          id: `${convId}-msg-2`,
          conversation_id: convId,
          role: "assistant",
          content:
            "I can help with a wide range of tasks — ask me anything!",
          created_at: now,
          updated_at: now,
        },
      ],
      total: 2,
      page: 1,
      page_size: 100,
      has_more: false,
    },
  };
}

/** Inject an __APP_CONFIG__ override after the page's own script runs. */
async function injectConfig(
  page: import("@playwright/test").Page,
  overrides: Record<string, unknown>,
) {
  await page.evaluate((cfg) => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__APP_CONFIG__ && typeof w.__APP_CONFIG__ === "object") {
      Object.assign(w.__APP_CONFIG__ as object, cfg);
    }
  }, overrides);
}

async function bootSession(
  page: import("@playwright/test").Page,
  extraHandlers: Parameters<typeof installChatBootMocks>[2] = {},
) {
  test.skip(!process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET required for session minting.");
  const e = env();

  await installChatBootMocks(page, e, {
    conversationId: CONV_ID,
    agentId: AGENT_ID,
    ...extraHandlers,
  });

  // Override turns endpoint to return messages with an assistant turn
  await page.route(`**/api/chat/conversations/${CONV_ID}/turns`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(assistantMessageFixture(CONV_ID)),
    });
  });

  await installTestSession(page, e, {
    email: SESSION.email,
    subject: SESSION.subject,
    role: "user",
  });

  return e;
}

test.describe("Report a Problem — global header button", () => {
  test.beforeEach(() => {
    test.skip(!E2E_ENABLED, "Set RUN_REPORT_PROBLEM_E2E=1 to run these tests.");
  });

  test("header 'Report a Problem' button is visible with default config", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    const btn = page.getByRole("button", { name: "Report a Problem" });
    await expect(btn).toBeVisible({ timeout: 8_000 });

    await page.screenshot({ path: "test-results/report-problem-header-button.png", fullPage: false });
  });

  test("clicking header button opens the Report a Problem dialog", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    await page.getByRole("button", { name: "Report a Problem" }).click();

    const dialog = page.getByRole("dialog", { name: /report a problem/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: "test-results/report-problem-dialog-open.png", fullPage: false });
  });

  test("header button is hidden when reportProblemEnabled=false", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    await injectConfig(page, { reportProblemEnabled: false });
    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    const btn = page.getByRole("button", { name: "Report a Problem" });
    await expect(btn).toBeHidden({ timeout: 5_000 });

    await page.screenshot({ path: "test-results/report-problem-header-hidden.png", fullPage: false });
  });
});

test.describe("Report a Problem — feedback thumbs shortcut", () => {
  test.beforeEach(() => {
    test.skip(!E2E_ENABLED, "Set RUN_REPORT_PROBLEM_E2E=1 to run these tests.");
  });

  async function openChatWithMessages(page: import("@playwright/test").Page) {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);
    await expectChatComposerReady(page);
  }

  test("AlertTriangle shortcut button appears next to thumbs", async ({ page }) => {
    await openChatWithMessages(page);

    // Hover over the assistant message to reveal message actions
    const assistantMsg = page
      .locator('[data-role="assistant"]')
      .or(page.locator(".message-assistant"))
      .last();

    await assistantMsg.hover({ force: true, timeout: 5_000 }).catch(() => {
      // fallback: hover over message content area
    });

    // The triangle (AlertTriangle) button should be visible alongside thumbs
    const triangleBtn = page.getByRole("button", { name: "Report a Problem" }).last();
    await expect(triangleBtn).toBeVisible({ timeout: 6_000 });

    await page.screenshot({
      path: "test-results/report-problem-thumb-triangle.png",
      fullPage: false,
    });
  });

  test("feedback dialog does NOT contain 'Report a Problem' inline link", async ({ page }) => {
    await openChatWithMessages(page);

    // Find and click thumbs down on an assistant message
    const assistantMsg = page
      .locator('[data-role="assistant"]')
      .or(page.locator(".message-assistant"))
      .last();

    await assistantMsg.hover({ force: true, timeout: 5_000 }).catch(() => {});

    const thumbsDown = page.getByRole("button", { name: "Not helpful" }).last();
    await thumbsDown.click({ timeout: 6_000 });

    // Feedback dialog should open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: "test-results/report-problem-feedback-dialog.png",
      fullPage: false,
    });

    // "Report a Problem" link should NOT be inside the feedback dialog
    const inlineLink = dialog.getByRole("button", { name: /report a problem/i });
    await expect(inlineLink).toHaveCount(0);
  });

  test("'Submit & Report' button is hidden when reportProblemEnabled=false", async ({ page }) => {
    await openChatWithMessages(page);

    await injectConfig(page, {
      reportProblemEnabled: false,
      ticketEnabled: true,
      ticketProvider: "github",
    });

    const assistantMsg = page
      .locator('[data-role="assistant"]')
      .or(page.locator(".message-assistant"))
      .last();

    await assistantMsg.hover({ force: true, timeout: 5_000 }).catch(() => {});

    const thumbsDown = page.getByRole("button", { name: "Not helpful" }).last();
    await thumbsDown.click({ timeout: 6_000 });

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Triangle button should be gone
    const triangleBtn = dialog.getByRole("button", { name: "Report a Problem" });
    await expect(triangleBtn).toHaveCount(0);

    // Submit & Report button should also be gone
    const submitAndReport = dialog.getByRole("button", { name: /submit.*report/i });
    await expect(submitAndReport).toHaveCount(0);

    await page.screenshot({
      path: "test-results/report-problem-disabled.png",
      fullPage: false,
    });
  });
});
