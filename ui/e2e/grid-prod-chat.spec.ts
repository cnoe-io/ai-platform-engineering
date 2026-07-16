import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { allGridProdScenarios, type GridProdScenario } from "./fixtures/grid-prod-scenarios";

const defaultGridChatUrl = "https://grid.outshift.io/chat";
const gridChatUrl = process.env.GRID_CHAT_URL || defaultGridChatUrl;
const gridStorageState = process.env.GRID_STORAGE_STATE;
const gridAuthTimeoutMs = Number(process.env.GRID_AUTH_TIMEOUT_MS || 30_000);
const shouldRunGridProd = process.env.RUN_GRID_PROD === "true";
const scenarios = loadGridScenarios();

test.describe("GRID prod chat scenarios", () => {
  test.skip(!shouldRunGridProd, "Set RUN_GRID_PROD=true to run against the live GRID chat app.");
  test.use(gridStorageState ? { storageState: gridStorageState } : {});
  test.describe.configure({ mode: "serial" });

  test("opens the configured GRID chat", async ({ page }) => {
    await openGridChat(page);
  });

  for (const scenario of scenarios) {
    test(scenario.name, async ({ page }) => {
      const input = await openGridChat(page);
      await input.fill(scenario.prompt);
      await sendMessage(page);

      await expect(page.getByText(scenario.prompt)).toBeVisible();

      for (const expectedText of expectedLiveText(scenario)) {
        await expect(page.getByText(new RegExp(escapeRegExp(expectedText), "i")).last()).toBeVisible({
          timeout: 90_000,
        });
      }

      await expect(page.getByText(/^Error:/i).first()).not.toBeVisible();
    });
  }
});

function loadGridScenarios(): GridProdScenario[] {
  if (process.env.GRID_SCENARIOS_JSON) {
    return JSON.parse(process.env.GRID_SCENARIOS_JSON) as GridProdScenario[];
  }

  if (process.env.GRID_SCENARIOS_PATH) {
    return JSON.parse(readFileSync(process.env.GRID_SCENARIOS_PATH, "utf8")) as GridProdScenario[];
  }

  return allGridProdScenarios;
}

function expectedLiveText(scenario: GridProdScenario) {
  return scenario.liveExpected ?? scenario.expectedResponse;
}

async function openGridChat(page: Page): Promise<Locator> {
  await page.goto(gridChatUrl, { waitUntil: "domcontentloaded" });

  const input = await waitForChatInput(page);
  await expect(input).toBeVisible({ timeout: 5_000 });
  return input;
}

async function waitForChatInput(page: Page): Promise<Locator> {
  const deadline = Date.now() + gridAuthTimeoutMs;
  let authSignal = "chat input was not visible";

  while (Date.now() < deadline) {
    const input = await chatInput(page);
    if (await isVisible(input)) return input;

    authSignal = await currentAuthSignal(page);
    await page.waitForTimeout(1_000);
  }

  throw new Error(liveAuthError(page.url(), authSignal));
}

async function chatInput(page: Page): Promise<Locator> {
  const byPlaceholder = page.getByPlaceholder(/Ask CAIPE anything|Ask anything|message|chat/i).first();
  if (await byPlaceholder.count()) return byPlaceholder;

  const textarea = page.locator("textarea").first();
  if (await textarea.count()) return textarea;

  return page.locator("[contenteditable='true']").first();
}

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function currentAuthSignal(page: Page): Promise<string> {
  if (await isVisible(page.getByText(/Checking authentication/i).first())) {
    return "'Checking authentication...' is still visible";
  }

  if (await isVisible(page.getByRole("button", { name: /sign in|log in|login/i }).first())) {
    return "a sign-in control is visible";
  }

  if (/\/login|authorize|oauth|sso|okta/i.test(page.url())) {
    return `browser is on an auth URL: ${page.url()}`;
  }

  return "chat input was not visible";
}

function liveAuthError(url: string, authSignal: string): string {
  return [
    `GRID live chat is not authenticated: ${authSignal} at ${url}.`,
    "Playwright runs in an isolated browser context, so your regular Chrome SSO cookies are not shared.",
    "Create a storage state file with SSO cookies, then rerun with GRID_STORAGE_STATE=./e2e/.auth/grid-prod.json.",
  ].join(" ");
}

async function sendMessage(page: Page) {
  const titledButton = page.getByTitle(/Send message|Send/i).first();
  if (await titledButton.count()) {
    await titledButton.click();
    return;
  }

  const roleButton = page.getByRole("button", { name: /Send/i }).first();
  if (await roleButton.count()) {
    await roleButton.click();
    return;
  }

  await page.keyboard.press("Enter");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
