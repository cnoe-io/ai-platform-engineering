import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";

interface GridScenario {
  name: string;
  prompt: string;
  expected?: string[];
}

const defaultGridChatUrl = "https://grid.outshift.io/chat/0e5a25f1-56ff-4004-a608-4c0ad8fe6b5e";
const gridChatUrl = process.env.GRID_CHAT_URL || defaultGridChatUrl;
const shouldRunGridProd = process.env.RUN_GRID_PROD === "true";
const scenarios = loadGridScenarios();

test.describe("GRID prod chat scenarios", () => {
  test.skip(!shouldRunGridProd, "Set RUN_GRID_PROD=true to run against the live GRID chat app.");
  test.describe.configure({ mode: "serial" });

  test("opens the configured GRID chat", async ({ page }) => {
    await page.goto(gridChatUrl, { waitUntil: "domcontentloaded" });

    await expect(await chatInput(page)).toBeVisible();
  });

  for (const scenario of scenarios) {
    test(scenario.name, async ({ page }) => {
      await page.goto(gridChatUrl, { waitUntil: "domcontentloaded" });

      const input = await chatInput(page);
      await input.fill(scenario.prompt);
      await sendMessage(page);

      await expect(page.getByText(scenario.prompt)).toBeVisible();

      for (const expectedText of scenario.expected ?? []) {
        await expect(page.getByText(new RegExp(escapeRegExp(expectedText), "i")).last()).toBeVisible({
          timeout: 90_000,
        });
      }

      await expect(page.getByText(/^Error:/i)).toHaveCount(0);
    });
  }
});

function loadGridScenarios(): GridScenario[] {
  if (process.env.GRID_SCENARIOS_JSON) {
    return JSON.parse(process.env.GRID_SCENARIOS_JSON) as GridScenario[];
  }

  if (process.env.GRID_SCENARIOS_PATH) {
    return JSON.parse(fs.readFileSync(process.env.GRID_SCENARIOS_PATH, "utf8")) as GridScenario[];
  }

  return [
    {
      name: "Basic Outshift SRE triage",
      prompt: "Run basic Outshift SRE triage across GitHub, ArgoCD, AWS, PagerDuty, and Splunk",
      expected: ["Outshift", "SRE"],
    },
  ];
}

async function chatInput(page: Page): Promise<Locator> {
  const byPlaceholder = page.getByPlaceholder(/Ask CAIPE anything|Ask anything|message|chat/i).first();
  if (await byPlaceholder.count()) return byPlaceholder;

  const textarea = page.locator("textarea").first();
  if (await textarea.count()) return textarea;

  return page.locator("[contenteditable='true']").first();
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
