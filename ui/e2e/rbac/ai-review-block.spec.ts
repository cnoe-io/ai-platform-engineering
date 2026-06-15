// assisted-by claude:claude-sonnet-4-6
/**
 * Playwright tests for PR #1866 — AI Review failure UX in the agent editor.
 *
 * When a blocking AI Review fails:
 *   1. On the Instructions step ("Next" gate): toast fires, inline error shown,
 *      user stays on Instructions.
 *   2. On a later step ("Save" gate): toast fires, editor navigates back to
 *      Instructions, inline error updated to point there.
 *
 * These are mocked-RBAC browser regressions. Set RUN_RBAC_REGRESSION=1 to run.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
} from "./_mocked-rbac";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const BLOCKING_REVIEW_CONFIG = {
  target: "agent-system-prompt",
  enabled: true,
  enforcement: "blocking",
  criteria: [
    {
      id: "crit-1",
      label: "No placeholder text",
      description: "Prompt must not contain TODO or placeholder content.",
    },
  ],
};

const FAILED_REVIEW_RESULT = {
  target: "agent-system-prompt",
  passed: false,
  grade: "F",
  score: 0,
  hash: "abc123",
  criteria: [
    {
      id: "crit-1",
      passed: false,
      comment: "System prompt contains placeholder text.",
      suggested_fix: null,
    },
  ],
};

async function installEditorMocks(page: Page): Promise<void> {
  await installMockedRbacApp(page, {
    isAdmin: true,
    handlers: [
      async ({ route, path, method }) => {
        // Models list — return one model so the editor does not block on missing model
        if (path === "/api/dynamic-agents/models" && method === "GET") {
          await fulfillJson(route, {
            success: true,
            data: [
              {
                id: "claude-sonnet-4-6",
                name: "Claude Sonnet 4.6",
                provider: "anthropic",
                available: true,
              },
            ],
          });
          return true;
        }

        // Existing agent IDs — empty so no ID clash
        if (path === "/api/dynamic-agents" && method === "GET") {
          await fulfillJson(route, {
            success: true,
            data: { items: [], total: 0, page: 1, page_size: 100, has_more: false },
          });
          return true;
        }

        // Teams list
        if (path === "/api/dynamic-agents/teams" && method === "GET") {
          await fulfillJson(route, {
            success: true,
            data: [{ _id: "team-1", slug: "platform", name: "Platform Team" }],
          });
          return true;
        }

        // Blocking review config for the system-prompt target
        if (path === "/api/review-configs/agent-system-prompt" && method === "GET") {
          await fulfillJson(route, BLOCKING_REVIEW_CONFIG);
          return true;
        }

        // AI Review endpoint — always returns a failing result
        if (path === "/api/ai/review" && method === "POST") {
          await fulfillJson(route, { success: true, data: FAILED_REVIEW_RESULT });
          return true;
        }

        return false;
      },
    ],
  });
}

/** Open the New Agent editor from the dynamic-agents page. */
async function openNewAgentEditor(page: Page): Promise<void> {
  await page.goto("/dynamic-agents?tab=agents", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /new agent/i }).click();
  // Wait for the editor heading to confirm it's mounted
  await expect(page.getByText(/step 1/i)).toBeVisible({ timeout: 10_000 });
}

/**
 * Fill the Basic Info step (minimum required fields) and advance to Instructions.
 * We do NOT use the AI Review-gated "Next" button from Instructions here — that's
 * what the test under examination exercises. Instead we rely on the step indicator
 * to jump directly to Instructions after Basic Info is filled.
 */
async function fillBasicInfoAndGoToInstructions(page: Page): Promise<void> {
  // Fill agent name on Basic Info (step 1)
  await page.getByLabel(/agent name/i).fill("Playwright Test Agent");

  // Select model — click the combobox and pick the first option
  const modelSelect = page.getByRole("combobox").first();
  await modelSelect.click();
  await page.getByRole("option").first().click();

  // Click the Instructions step in the step indicator to jump directly
  await page.getByRole("button", { name: /instructions/i }).click();
  await expect(page.getByText(/step 2/i)).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("AI Review failure UX — blocking review (PR #1866)", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("toast fires and user stays on Instructions when Next is blocked by a failing review", async ({
    page,
  }) => {
    await installEditorMocks(page);
    await openNewAgentEditor(page);
    await fillBasicInfoAndGoToInstructions(page);

    // Type something in the system prompt so the review can run (non-empty content)
    const promptArea = page.getByRole("textbox", { name: /system prompt/i });
    if (await promptArea.isVisible()) {
      await promptArea.fill("TODO: add real instructions here");
    }

    // Click Next — this triggers `goToNextStep`, which calls `ensurePassedOrRun`
    await page.getByRole("button", { name: /^next$/i }).click();

    // 1. An error toast must appear with text about the review failure
    const toast = page.locator("text=/AI Review failed/i").first();
    await expect(toast).toBeVisible({ timeout: 15_000 });

    // 2. The user must still be on the Instructions step (not Tools)
    await expect(page.getByText(/step 2/i)).toBeVisible();
    await expect(page.getByText(/step 3/i)).not.toBeVisible();

    // 3. Inline error message visible in the editor
    await expect(
      page.getByText(/address the comments below before continuing/i),
    ).toBeVisible();
  });

  test("toast fires and editor navigates to Instructions when Save is blocked from a later step", async ({
    page,
  }) => {
    await installEditorMocks(page);
    await openNewAgentEditor(page);
    await fillBasicInfoAndGoToInstructions(page);

    // Move past Instructions to Tools by clicking the step indicator directly
    // (bypassing the Next gate — simulating a user who pre-passed review then
    // moved on, or who navigated via the step pill after a prior pass)
    await page.getByRole("button", { name: /tools/i }).click();
    await expect(page.getByText(/step 3/i)).toBeVisible({ timeout: 5_000 });

    // Attempt Save from the Tools step
    const saveButton = page.getByRole("button", { name: /save changes|create agent/i });
    await saveButton.click();

    // 1. Toast must appear announcing the review failure
    const toast = page.locator("text=/AI Review failed/i").first();
    await expect(toast).toBeVisible({ timeout: 15_000 });

    // 2. Editor must have navigated back to the Instructions step
    await expect(page.getByText(/step 2/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/step 3/i)).not.toBeVisible();

    // 3. Inline error message references the Instructions step
    await expect(
      page.getByText(/instructions step before saving/i),
    ).toBeVisible();
  });
});
