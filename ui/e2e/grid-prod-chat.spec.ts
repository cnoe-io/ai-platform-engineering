import { expect, test, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { allGridProdScenarios, type GridProdScenario } from "./fixtures/grid-prod-scenarios";

const defaultGridChatUrl = "https://grid.outshift.io/chat";
const gridChatUrl = process.env.GRID_CHAT_URL || defaultGridChatUrl;
const defaultGridStorageState = "./e2e/.auth/grid-prod.json";
const gridSaveStorageState = process.env.GRID_SAVE_STORAGE_STATE || defaultGridStorageState;
const gridStorageState = process.env.GRID_STORAGE_STATE || gridSaveStorageState;
const gridInteractiveSso = process.env.GRID_INTERACTIVE_SSO === "true";
const gridSsoEmail = process.env.GRID_SSO_EMAIL;
const defaultGridAuthTimeoutMs = gridInteractiveSso ? 600_000 : 30_000;
const gridAuthTimeoutMs = Number(process.env.GRID_AUTH_TIMEOUT_MS || defaultGridAuthTimeoutMs);
const gridExecutionTimeoutMs = Number(process.env.GRID_EXECUTION_TIMEOUT_MS || 300_000);
const gridAutoApproveToolCalls = process.env.GRID_AUTO_APPROVE_TOOL_CALLS === "true";
const gridHitlFormValues = loadGridHitlFormValues("GRID_HITL_FORM_VALUES_JSON");
const gridReuseConversation = process.env.GRID_REUSE_CONVERSATION === "true";
const gridDismissPopups = process.env.GRID_DISMISS_POPUPS !== "false";
const shouldRunGridProd = process.env.RUN_GRID_PROD === "true";
const scenarios = loadGridScenarios();

test.describe("GRID prod chat scenarios", () => {
  test.skip(!shouldRunGridProd, "Set RUN_GRID_PROD=true to run against the live GRID chat app.");
  test.use(gridStorageState && existsSync(gridStorageState) ? { storageState: gridStorageState } : {});
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    installPopupDismissal(page);
  });

  test("opens the configured GRID chat", async ({ page }) => {
    await openGridChat(page);
  });

  for (const scenario of scenarios) {
    test(scenario.name, async ({ page }) => {
      test.setTimeout(Math.max(90_000, gridAuthTimeoutMs + gridExecutionTimeoutMs + 30_000));
      const prompt = livePrompt(scenario);
      const input = await openGridChat(page);
      await dismissBlockingPopups(page);
      await input.fill(prompt);
      await sendMessage(page);
      await dismissBlockingPopups(page);

      await expect(page.getByText(prompt)).toBeVisible();
      await waitForScenarioExecution(page, scenario, prompt);
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

function loadGridHitlFormValues(envName: string): Record<string, string> {
  const rawValues = process.env[envName];
  if (!rawValues) return {};

  const parsed = JSON.parse(rawValues) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function expectedLiveText(scenario: GridProdScenario) {
  return scenario.liveExpected ?? scenario.expectedResponse;
}

function livePrompt(scenario: GridProdScenario) {
  return scenario.livePrompt ?? scenario.prompt;
}

async function openGridChat(page: Page): Promise<Locator> {
  await page.goto(gridChatUrl, { waitUntil: "domcontentloaded" });
  await dismissBlockingPopups(page);

  let input = await waitForChatInput(page);
  if (!gridReuseConversation) {
    await startFreshConversation(page);
    await dismissBlockingPopups(page);
    input = await waitForChatInput(page);
  }
  await expect(input).toBeVisible({ timeout: 5_000 });
  await saveGridStorageState(page);
  return input;
}

async function startFreshConversation(page: Page) {
  await dismissBlockingPopups(page);
  const newChat = await newChatControl(page);
  if (!(await isVisible(newChat))) return;

  const beforeUrl = page.url();
  await newChat.click({ timeout: 10_000 });
  await Promise.race([
    page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 2_000 }).catch(() => undefined),
    page.waitForTimeout(500),
  ]);
}

async function waitForChatInput(page: Page): Promise<Locator> {
  const deadline = Date.now() + gridAuthTimeoutMs;
  let authSignal = "chat input was not visible";
  let clickedInteractiveSso = false;
  let filledInteractiveEmail = false;

  while (Date.now() < deadline) {
    await dismissBlockingPopups(page);

    const input = await chatInput(page);
    if (await isVisible(input)) return input;

    if (gridInteractiveSso && !clickedInteractiveSso) {
      const clicked = await clickSsoButton(page);
      if (clicked) {
        clickedInteractiveSso = true;
        authSignal = "clicked the SSO sign-in control and is waiting for interactive login to finish";
        await page.waitForTimeout(2_000);
        continue;
      }
    }

    if (gridInteractiveSso && gridSsoEmail && !filledInteractiveEmail) {
      const filled = await fillSsoEmail(page, gridSsoEmail);
      if (filled) {
        filledInteractiveEmail = true;
        authSignal = "filled the SSO email and is waiting for password/MFA to finish";
        await page.waitForTimeout(2_000);
        continue;
      }
    }

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

function installPopupDismissal(page: Page) {
  if (!gridDismissPopups) return;

  page.on("dialog", async (dialog) => {
    await dialog.dismiss().catch(() => undefined);
  });

  page.on("popup", async (popup) => {
    await popup.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    if (!isAuthUrl(popup.url())) {
      await popup.close().catch(() => undefined);
    }
  });
}

async function dismissBlockingPopups(page: Page): Promise<boolean> {
  if (!gridDismissPopups || isAuthUrl(page.url())) return false;

  let dismissed = false;
  const blockingDialog = page.locator("[role='dialog'], [aria-modal='true']").last();

  if (await isVisible(blockingDialog)) {
    const closeButton = dismissButton(blockingDialog);
    if (await isVisible(closeButton)) {
      await closeButton.click({ timeout: 5_000 }).catch(() => undefined);
      return true;
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    dismissed = true;
    await page.waitForTimeout(300);
  }

  for (const name of dismissButtonNames()) {
    const button = page.getByRole("button", { name }).last();
    if (await isVisible(button)) {
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      dismissed = true;
      await page.waitForTimeout(300);
      break;
    }
  }

  return dismissed;
}

function dismissButton(scope: Locator): Locator {
  const names = dismissButtonNames().map((pattern) => pattern.source).join("|");
  return scope.getByRole("button", { name: new RegExp(names, "i") }).last();
}

function dismissButtonNames() {
  return [
    /^close$/,
    /^dismiss$/,
    /^got it$/,
    /^ok$/,
    /^okay$/,
    /^skip$/,
    /^maybe later$/,
    /^not now$/,
    /^no thanks$/,
    /^remind me later$/,
    /^accept$/,
    /^accept all$/,
    /^agree$/,
  ];
}

async function waitForScenarioExecution(page: Page, scenario: GridProdScenario, prompt: string) {
  const expectedTexts = expectedLiveText(scenario);
  const expectedAssistantTexts = expectedTexts.filter(
    (text) => !prompt.toLowerCase().includes(text.toLowerCase()),
  );
  const effectiveExpectedTexts = expectedAssistantTexts.length > 0
    ? expectedAssistantTexts
    : scenario.expectedResponse;
  const deadline = Date.now() + gridExecutionTimeoutMs;
  let lastSignal = "waiting for assistant response";

  while (Date.now() < deadline) {
    await dismissBlockingPopups(page);
    await failOnVisibleChatError(page);

    const hitlSignal = await handleHitlIfPresent(page, scenario);
    if (hitlSignal) {
      lastSignal = hitlSignal;
      await page.waitForTimeout(1_000);
      continue;
    }

    if (await hasCompletedToolSignal(page) && await hasAnyAssistantText(page, expectedTexts)) return;

    if (await hasAllAssistantText(page, effectiveExpectedTexts)) return;

    if (await isVisible(page.getByText(/\btool(s)?\b/i).last())) {
      lastSignal = "tool activity is visible but expected completion text has not appeared yet";
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error([
    `GRID scenario "${scenario.name}" did not show execution completion within ${gridExecutionTimeoutMs}ms.`,
    `Last observed state: ${lastSignal}.`,
    "If an Approval required card is visible, click Approve or rerun with GRID_AUTO_APPROVE_TOOL_CALLS=true.",
    "If an Input Required form is visible, fill it manually in UI mode or set GRID_HITL_FORM_VALUES_JSON.",
  ].join(" "));
}

async function handleHitlIfPresent(page: Page, scenario: GridProdScenario): Promise<string | undefined> {
  const approve = page.getByRole("button", { name: /^approve$/i }).last();
  if (await isVisible(approve)) {
    if (gridAutoApproveToolCalls) {
      await expect(approve).toBeEnabled({ timeout: 30_000 });
      await approve.click();
      return "approved a tool call and is waiting for execution to continue";
    }
    return "waiting for manual tool approval";
  }

  const submit = page.getByRole("button", { name: /^submit$/i }).last();
  if (await isVisible(submit) && await isVisible(page.getByText(/Input Required|Additional Input Required|Please provide/i).last())) {
    const hitlFormValues = hitlFormValuesFor(scenario);
    if (Object.keys(hitlFormValues).length > 0) {
      const filledCount = await fillHitlForm(page, hitlFormValues);
      if (filledCount > 0) {
        await expect(submit).toBeEnabled({ timeout: 30_000 });
        await submit.click();
        return `submitted ${filledCount} input-required form value(s) and is waiting for execution to continue`;
      }

      return "input-required form is visible, but no fields matched the configured default values";
    }
    return "waiting for manual input-required form submission";
  }

  return undefined;
}

function hitlFormValuesFor(scenario: GridProdScenario): Record<string, string> {
  return {
    ...(scenario.hitlFormValues ?? {}),
    ...jiraEnvHitlValues(scenario),
    ...gridHitlFormValues,
    ...loadGridHitlFormValues(scenarioHitlEnvName(scenario)),
  };
}

function scenarioHitlEnvName(scenario: GridProdScenario) {
  return `GRID_${scenario.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_HITL_FORM_VALUES_JSON`;
}

function jiraEnvHitlValues(scenario: GridProdScenario): Record<string, string> {
  if (scenario.id !== "create-jira-ticket") return {};

  return compactValues({
    jira_project_key: process.env.GRID_JIRA_PROJECT_KEY,
    project_key: process.env.GRID_JIRA_PROJECT_KEY,
    project: process.env.GRID_JIRA_PROJECT_KEY,
    issue_type: process.env.GRID_JIRA_ISSUE_TYPE,
    summary: process.env.GRID_JIRA_SUMMARY,
    title: process.env.GRID_JIRA_SUMMARY,
    description: process.env.GRID_JIRA_DESCRIPTION,
    epic_key: process.env.GRID_JIRA_EPIC,
    epic: process.env.GRID_JIRA_EPIC,
    parent: process.env.GRID_JIRA_EPIC,
    labels: process.env.GRID_JIRA_LABELS,
    priority: process.env.GRID_JIRA_PRIORITY,
  });
}

function compactValues(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

async function fillHitlForm(page: Page, values: Record<string, string>): Promise<number> {
  const form = page.locator("form").last();
  if (!(await isVisible(form))) return 0;

  let filledCount = 0;
  const filledIndexes = new Set<number>();
  const entries = Object.entries(values).sort(([left], [right]) => right.length - left.length);

  for (const [fieldName, value] of entries) {
    const match = await matchingHitlField(form, fieldName, filledIndexes);
    if (!match) continue;

    const tagName = await match.field.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    let filled = true;
    if (tagName === "select") {
      filled = await selectHitlOption(match.field, value);
    } else {
      await match.field.fill(value);
    }

    if (!filled) continue;

    filledIndexes.add(match.index);
    filledCount += 1;
  }

  return filledCount;
}

async function matchingHitlField(
  form: Locator,
  fieldName: string,
  filledIndexes: Set<number>,
): Promise<{ field: Locator; index: number } | undefined> {
  const fields = form.locator(
    "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea, select",
  );
  const count = await fields.count();

  for (let index = 0; index < count; index += 1) {
    if (filledIndexes.has(index)) continue;

    const field = fields.nth(index);
    if (!(await field.isEnabled().catch(() => false))) continue;

    const descriptor = await hitlFieldDescriptor(field);
    if (fieldNameMatchesDescriptor(fieldName, descriptor)) {
      return { field, index };
    }
  }

  return undefined;
}

async function hitlFieldDescriptor(field: Locator): Promise<string> {
  return field.evaluate((node) => {
    const parts = [
      node.getAttribute("aria-label"),
      node.getAttribute("name"),
      node.getAttribute("id"),
      node.getAttribute("placeholder"),
      node.getAttribute("autocomplete"),
    ];

    let current = node.parentElement;
    for (let depth = 0; current && depth < 3; depth += 1, current = current.parentElement) {
      if (current.tagName.toLowerCase() === "form") break;

      const localText = Array.from(current.querySelectorAll("label, p, span"))
        .map((child) => child.textContent ?? "")
        .join(" ");
      parts.push(localText);
    }

    return parts.filter(Boolean).join(" ");
  });
}

function fieldNameMatchesDescriptor(fieldName: string, descriptor: string) {
  const normalizedDescriptor = normalizeFieldName(descriptor);
  return fieldNameAliases(fieldName).some((alias) => normalizedDescriptor.includes(normalizeFieldName(alias)));
}

function fieldNameAliases(fieldName: string) {
  const spaced = fieldName.replace(/[_-]+/g, " ").trim();
  const aliases = new Set([fieldName, spaced]);
  aliases.add(spaced.replace(/^(jira|ticket|issue)\s+/, ""));
  aliases.add(spaced.replace(/\s+(key|id)$/, ""));
  aliases.add(spaced.replace(/^(jira|ticket|issue)\s+/, "").replace(/\s+(key|id)$/, ""));
  return Array.from(aliases).filter(Boolean);
}

function normalizeFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function selectHitlOption(field: Locator, value: string): Promise<boolean> {
  const selectedByValue = await field.selectOption(value).then(() => true).catch(() => false);
  if (selectedByValue) return true;

  const selectedByLabel = await field.selectOption({ label: value }).then(() => true).catch(() => false);
  if (selectedByLabel) return true;

  const matchingValue = await field.evaluate((node, expected) => {
    const select = node as HTMLSelectElement;
    const normalizedExpected = String(expected).toLowerCase();
    const option = Array.from(select.options).find((candidate) => {
      const label = candidate.label || candidate.textContent || "";
      return label.toLowerCase().includes(normalizedExpected) || candidate.value.toLowerCase().includes(normalizedExpected);
    });
    return option?.value || "";
  }, value);

  if (matchingValue) {
    await field.selectOption(matchingValue);
    return true;
  }

  return false;
}

async function failOnVisibleChatError(page: Page) {
  const error = page.getByText(/^Error:/i).first();
  if (await isVisible(error)) {
    throw new Error(`GRID chat surfaced an error: ${(await error.textContent())?.trim()}`);
  }
}

async function hasCompletedToolSignal(page: Page): Promise<boolean> {
  const completedTool = page.getByText(/\b(done|completed|success|created|validated|finished)\b/i).last();
  const toolSummary = page.getByText(/\d+\s+tool/i).last();
  return (await isVisible(completedTool)) && (await isVisible(toolSummary));
}

async function hasAllAssistantText(page: Page, expectedTexts: string[]): Promise<boolean> {
  for (const expectedText of expectedTexts) {
    if (!(await hasAssistantText(page, expectedText))) return false;
  }
  return true;
}

async function hasAnyAssistantText(page: Page, expectedTexts: string[]): Promise<boolean> {
  for (const expectedText of expectedTexts) {
    if (await hasAssistantText(page, expectedText)) return true;
  }
  return false;
}

async function hasAssistantText(page: Page, expectedText: string): Promise<boolean> {
  return isVisible(assistantText(page, expectedText));
}

function assistantText(page: Page, expectedText: string): Locator {
  return page
    .locator(assistantMessageXPath())
    .filter({ hasText: new RegExp(escapeRegExp(expectedText), "i") })
    .last();
}

async function clickSsoButton(page: Page): Promise<boolean> {
  const signInButton = await signInControl(page);
  if (!(await isVisible(signInButton))) return false;

  const beforeUrl = page.url();
  await Promise.all([
    page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 15_000 }).catch(() => undefined),
    signInButton.click({ timeout: 10_000 }),
  ]);
  return true;
}

async function fillSsoEmail(page: Page, email: string): Promise<boolean> {
  if (!/duosecurity|email_first|idp\.grid\.outshift\.io|authorize/i.test(page.url())) return false;

  const emailInput = await ssoEmailInput(page);
  if (!(await isVisible(emailInput))) return false;

  const currentValue = await emailInput.inputValue().catch(() => "");
  if (currentValue.trim().toLowerCase() !== email.trim().toLowerCase()) {
    await emailInput.click();
    await emailInput.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await emailInput.press("Backspace");
    await emailInput.pressSequentially(email, { delay: 35 });
    await expect(emailInput).toHaveValue(email, { timeout: 10_000 });
  }

  const nextButton = page.getByRole("button", { name: /^next$/i }).first();
  if (await isVisible(nextButton)) {
    await expect(nextButton).toBeEnabled({ timeout: 30_000 });
    const beforeUrl = page.url();
    await Promise.all([
      page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 15_000 }).catch(() => undefined),
      nextButton.click({ timeout: 10_000 }),
    ]);
  }

  return true;
}

async function currentAuthSignal(page: Page): Promise<string> {
  if (await isVisible(page.getByText(/Checking authentication/i).first())) {
    return "'Checking authentication...' is still visible";
  }

  if (await isVisible(await signInControl(page))) {
    return "a sign-in control is visible";
  }

  if (/\/login|authorize|oauth|sso|okta|duosecurity|idp\.grid\.outshift\.io/i.test(page.url())) {
    return `browser is on an auth URL: ${page.url()}`;
  }

  return "chat input was not visible";
}

function isAuthUrl(url: string) {
  return /\/login|authorize|oauth|sso|okta|duosecurity|idp\.grid\.outshift\.io/i.test(url);
}

async function signInControl(page: Page): Promise<Locator> {
  const name = /sign in with sso|sign in|log in|login/i;
  const button = page.getByRole("button", { name }).first();
  if (await button.count()) return button;

  return page.getByRole("link", { name }).first();
}

async function newChatControl(page: Page): Promise<Locator> {
  const button = page.getByRole("button", { name: /new chat|start a new chat|new conversation/i }).first();
  if (await button.count()) return button;

  return page.getByRole("link", { name: /new chat|start a new chat|new conversation/i }).first();
}

async function ssoEmailInput(page: Page): Promise<Locator> {
  const byLabel = page.getByLabel(/email address|email|username/i).first();
  if (await byLabel.count()) return byLabel;

  const byPlaceholder = page.getByPlaceholder(/email address|email|username/i).first();
  if (await byPlaceholder.count()) return byPlaceholder;

  const typedInput = page.locator("input[type='email'], input[name*='email' i], input[id*='email' i], input[autocomplete='username']").first();
  if (await typedInput.count()) return typedInput;

  return page.locator("input").first();
}

async function saveGridStorageState(page: Page) {
  if (!gridSaveStorageState) return;

  await page.context().storageState({ path: gridSaveStorageState });
}

function liveAuthError(url: string, authSignal: string): string {
  return [
    `GRID live chat is not authenticated: ${authSignal} at ${url}.`,
    "Playwright runs in an isolated browser context, so your regular Chrome SSO cookies are not shared.",
    "Create a storage state file with SSO cookies, or rerun with GRID_INTERACTIVE_SSO=true in Playwright UI mode.",
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

function assistantMessageXPath() {
  return [
    "xpath=//*[contains(concat(' ', normalize-space(@class), ' '), ' flex-row ')",
    "and not(contains(concat(' ', normalize-space(@class), ' '), ' flex-row-reverse '))]",
  ].join("");
}
