// assisted-by claude claude-sonnet-4-6
/**
 * E2E regression suite for the Provide Feedback dialog (formerly "Report a
 * Problem"):
 * - Global header button (configurable routing)
 * - AlertTriangle shortcut button next to feedback thumbs
 * - Feedback dialog no longer has an inline "Provide Feedback" link
 * - REPORT_PROBLEM_ENABLED=false hides all UI
 * - Issue Type + Area chips are mandatory and drive GitHub vs. Jira routing
 * - Submitting actually calls the right BFF route and shows a success state
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

/**
 * Message-list fixture matching the Message interface (types/mongodb.ts) that
 * chat-store.ts's loadMessages() actually consumes from
 * GET /api/chat/conversations/{id}/messages — NOT the (dead-code, never
 * called from the app) getTurns()/{id}/turns endpoint the previous version
 * of this fixture targeted.
 */
function assistantMessageFixture(convId: string) {
  const now = new Date().toISOString();
  return {
    success: true,
    data: {
      items: [
        {
          message_id: `${convId}-msg-1`,
          conversation_id: convId,
          role: "user",
          content: "What can you help me with?",
          created_at: now,
          metadata: { turn_id: `${convId}-turn-1`, is_final: true },
        },
        {
          message_id: `${convId}-msg-2`,
          conversation_id: convId,
          role: "assistant",
          content:
            "I can help with a wide range of tasks — ask me anything!",
          created_at: now,
          metadata: { turn_id: `${convId}-turn-1`, is_final: true },
        },
      ],
      total: 2,
      page: 1,
      page_size: 100,
      has_more: false,
    },
  };
}

/**
 * Force an __APP_CONFIG__ override to survive `page.reload()`.
 *
 * The app injects `window.__APP_CONFIG__ = {...}` via a plain inline <script>
 * on every document load (see layout.tsx). A one-off `page.evaluate()` only
 * patches the CURRENT in-memory object — a full reload/navigation replaces
 * `window` entirely and wipes it out. `addInitScript` instead installs a
 * property descriptor before any page script runs, so when the inline script
 * later does `window.__APP_CONFIG__ = {...}`, the setter merges our
 * overrides in — on this navigation and every subsequent reload.
 */
async function injectConfig(
  page: import("@playwright/test").Page,
  overrides: Record<string, unknown>,
) {
  await page.addInitScript((cfg) => {
    let value: Record<string, unknown> | undefined;
    Object.defineProperty(window, "__APP_CONFIG__", {
      configurable: true,
      get() {
        return value;
      },
      set(v: Record<string, unknown>) {
        value = { ...v, ...cfg };
      },
    });
  }, overrides);
  await page.reload({ waitUntil: "domcontentloaded" });
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

  // Override the messages endpoint (chat-store.ts loadMessages() ->
  // apiClient.getMessages() -> GET .../messages?page_size=...) to return a
  // real assistant message. getMessages() always appends a query string, so
  // the glob needs a trailing wildcard — an exact-suffix pattern never
  // matches and silently falls through to installChatBootMocks's catch-all
  // (which returns empty items).
  await page.route(`**/api/chat/conversations/${CONV_ID}/messages**`, async (route) => {
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

/** Open the header "Provide Feedback" dialog, select Issue Type + Area chips. */
async function openDialogAndSelectChips(
  page: import("@playwright/test").Page,
  issueType: "Bug" | "Enhancement",
  area: string,
) {
  await page.getByRole("button", { name: "Provide Feedback" }).click();
  const dialog = page.getByRole("dialog", { name: /provide feedback/i });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  await dialog.getByRole("button", { name: issueType, exact: true }).click();
  await dialog.getByRole("button", { name: area, exact: true }).click();
  return dialog;
}

test.describe("Provide Feedback — global header button", () => {
  test.beforeEach(() => {
    test.skip(!E2E_ENABLED, "Set RUN_REPORT_PROBLEM_E2E=1 to run these tests.");
  });

  test("header 'Provide Feedback' button is visible with default config", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    const btn = page.getByRole("button", { name: "Provide Feedback" });
    await expect(btn).toBeVisible({ timeout: 8_000 });

    await page.screenshot({ path: "test-results/report-problem-header-button.png", fullPage: false });
  });

  test("clicking header button opens the Provide Feedback dialog", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    await page.getByRole("button", { name: "Provide Feedback" }).click();

    const dialog = page.getByRole("dialog", { name: /provide feedback/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: "test-results/report-problem-dialog-open.png", fullPage: false });
  });

  test("header button is hidden when reportProblemEnabled=false", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    await injectConfig(page, { reportProblemEnabled: false });
    await dismissReleaseUpgradeDialog(page);

    const btn = page.getByRole("button", { name: "Provide Feedback" });
    await expect(btn).toBeHidden({ timeout: 5_000 });

    await page.screenshot({ path: "test-results/report-problem-header-hidden.png", fullPage: false });
  });

  test("Issue Type and Area chips are shown, and Submit is disabled until both are selected", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    await page.getByRole("button", { name: "Provide Feedback" }).click();
    const dialog = page.getByRole("dialog", { name: /provide feedback/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // "Type"/"Area" chip-row labels are exact ("Type *"/"Area *") — a loose
    // substring match also hits the dialog's own subtitle text ("Select the
    // type and area, then describe the issue.").
    await expect(dialog.getByText("Type *")).toBeVisible();
    await expect(dialog.getByText("Area *")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Bug", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Enhancement", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "TOME", exact: true })).toBeVisible();

    const submitBtn = dialog.getByRole("button", { name: "Submit Report" });
    await expect(submitBtn).toBeDisabled();

    await dialog.getByRole("button", { name: "Bug", exact: true }).click();
    await dialog.getByRole("button", { name: "TOME", exact: true }).click();
    await dialog.getByPlaceholder(/what went wrong/i).fill("Something broke");

    await expect(dialog.getByRole("button", { name: /Submit GitHub Issue/ })).toBeEnabled();
  });

  test("selecting TOME routes to GitHub; selecting a non-TOME area routes to Jira", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    // Destination hint text is anchored on "→", which only appears in the
    // hint span — a bare /GitHub issue/i also matches the "Submit GitHub
    // Issue" button's accessible name under strict mode.
    const dialog = await openDialogAndSelectChips(page, "Bug", "TOME");
    await expect(dialog.getByText(/→ GitHub issue/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Submit GitHub Issue/ })).toBeVisible();

    await dialog.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(dialog.getByText(/→ Jira ticket/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Submit Jira Ticket/ })).toBeVisible();

    await page.screenshot({ path: "test-results/report-problem-area-routing.png", fullPage: false });
  });

  test("submitting with TOME selected posts to /api/tickets/report and shows the GitHub result", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    let reportCalled = false;
    await page.route("**/api/tickets/report", async (route) => {
      reportCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { id: "#42", url: "https://github.com/org/repo/issues/42", number: 42, provider: "github" },
        }),
      });
    });

    const dialog = await openDialogAndSelectChips(page, "Bug", "TOME");
    await dialog.getByPlaceholder(/what went wrong/i).fill("Something broke");
    await dialog.getByRole("button", { name: /Submit GitHub Issue/ }).click();

    // Re-query by role only (no name filter): on success the dialog's own
    // title changes from "Provide Feedback" to "Ticket Created", so reusing
    // the pre-submit `dialog` locator (matched by name) would match nothing.
    const resultDialog = page.getByRole("dialog");
    await expect(resultDialog.getByText("#42")).toBeVisible({ timeout: 8_000 });
    expect(reportCalled).toBe(true);

    await page.screenshot({ path: "test-results/report-problem-github-success.png", fullPage: false });
  });

  test("submitting with a non-TOME area posts to /api/tickets/jira and shows the Jira result", async ({ page }) => {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);

    let jiraCalled = false;
    await page.route("**/api/tickets/jira", async (route) => {
      jiraCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { id: "OPENSD-99", url: "https://org.atlassian.net/browse/OPENSD-99", provider: "jira" },
        }),
      });
    });

    const dialog = await openDialogAndSelectChips(page, "Enhancement", "Chat");
    await dialog.getByPlaceholder(/what went wrong/i).fill("Please add dark mode");
    await dialog.getByRole("button", { name: /Submit Jira Ticket/ }).click();

    // See comment in the GitHub success test above — re-query without a name
    // filter, since the dialog's title changes on success.
    const resultDialog = page.getByRole("dialog");
    await expect(resultDialog.getByText("OPENSD-99")).toBeVisible({ timeout: 8_000 });
    expect(jiraCalled).toBe(true);

    await page.screenshot({ path: "test-results/report-problem-jira-success.png", fullPage: false });
  });
});

test.describe("Provide Feedback — feedback thumbs shortcut", () => {
  test.beforeEach(() => {
    test.skip(!E2E_ENABLED, "Set RUN_REPORT_PROBLEM_E2E=1 to run these tests.");
  });

  /**
   * Returns the assistant message locator only once it's actually visible —
   * `expectChatComposerReady` only waits for the composer textarea, not for
   * the mocked turns fetch to resolve and render the message, so hovering
   * immediately after it can race an empty conversation view.
   */
  async function openChatWithMessages(page: import("@playwright/test").Page) {
    await bootSession(page);
    await page.goto(`/chat/${CONV_ID}`, { waitUntil: "domcontentloaded" });
    await dismissReleaseUpgradeDialog(page);
    await expectChatComposerReady(page);

    const assistantMsg = page
      .locator('[data-message-role="assistant"]')
      .last();
    await expect(assistantMsg).toBeVisible({ timeout: 10_000 });
    return assistantMsg;
  }

  test("AlertTriangle shortcut button appears next to thumbs", async ({ page }) => {
    const assistantMsg = await openChatWithMessages(page);
    await assistantMsg.hover({ force: true, timeout: 5_000 });

    // The triangle (AlertTriangle) button should be visible alongside thumbs
    const triangleBtn = page.getByRole("button", { name: "Provide Feedback" }).last();
    await expect(triangleBtn).toBeVisible({ timeout: 6_000 });

    await page.screenshot({
      path: "test-results/report-problem-thumb-triangle.png",
      fullPage: false,
    });
  });

  test("feedback dialog does NOT contain a 'Provide Feedback' inline link", async ({ page }) => {
    const assistantMsg = await openChatWithMessages(page);
    await assistantMsg.hover({ force: true, timeout: 5_000 });

    const thumbsDown = page.getByRole("button", { name: "Not helpful" }).last();
    await thumbsDown.click({ timeout: 6_000 });

    // Feedback dialog should open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: "test-results/report-problem-feedback-dialog.png",
      fullPage: false,
    });

    // "Provide Feedback" link should NOT be inside the feedback dialog itself
    const inlineLink = dialog.getByRole("button", { name: /provide feedback/i });
    await expect(inlineLink).toHaveCount(0);
  });

  test("'Submit & Report' button is hidden when reportProblemEnabled=false", async ({ page }) => {
    await openChatWithMessages(page);

    // injectConfig reloads the page, so re-wait for the assistant message
    // to re-render post-reload rather than reusing the pre-reload locator.
    await injectConfig(page, {
      reportProblemEnabled: false,
      ticketEnabled: true,
      ticketProvider: "github",
    });
    await dismissReleaseUpgradeDialog(page);
    await expectChatComposerReady(page);

    const assistantMsg = page
      .locator('[data-message-role="assistant"]')
      .last();
    await expect(assistantMsg).toBeVisible({ timeout: 10_000 });
    await assistantMsg.hover({ force: true, timeout: 5_000 });

    const thumbsDown = page.getByRole("button", { name: "Not helpful" }).last();
    await thumbsDown.click({ timeout: 6_000 });

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Triangle button should be gone
    const triangleBtn = dialog.getByRole("button", { name: "Provide Feedback" });
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
