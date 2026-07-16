import { expect, test, type Page } from "@playwright/test";
import { expectAppReady, installCaipeMocks } from "./fixtures/a2a-mocks";
import {
  allGridProdScenarios,
  gridProdDeploymentValidationScenarios,
  gridProdIntegrationScenarios,
  gridProdWorkflowScenarios,
} from "./fixtures/grid-prod-scenarios";

test.describe("GRID Prod 0.5.x deployment testing", () => {
  test("keeps the PDF scenario inventory explicit", () => {
    expect(gridProdWorkflowScenarios.map((scenario) => scenario.id)).toEqual([
      "basic-outshift-sre-debug",
      "create-llm-key",
      "create-ec2-instance",
      "create-s3-bucket",
      "create-github-repo",
      "deploy-application",
      "debug-aws-k8s",
      "create-jira-ticket",
      "test-knowledge-base",
    ]);

    expect(gridProdDeploymentValidationScenarios.map((scenario) => scenario.id)).toEqual([
      "config-secret-injection",
      "rolling-update-zero-downtime",
      "argocd-rollback",
      "agent-tool-availability",
      "llm-gateway-connectivity",
      "rag-pipeline",
      "session-persistence",
      "graceful-degradation",
    ]);

    expect(gridProdIntegrationScenarios.map((scenario) => scenario.id)).toEqual([
      "webex-team-space-update",
    ]);

    expect(new Set(allGridProdScenarios.map((scenario) => scenario.id)).size).toBe(allGridProdScenarios.length);
  });

  for (const scenario of allGridProdScenarios) {
    test(`${scenario.area}: ${scenario.name}`, async ({ page }) => {
      const mocks = await installCaipeMocks(page);

      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      await expectAppReady(page);
      await submitPrompt(page, scenario.prompt);

      await expect(page.getByText(scenario.prompt)).toBeVisible();
      for (const expectedText of scenario.expectedResponse) {
        await expect(page.getByText(new RegExp(escapeRegExp(expectedText), "i")).last()).toBeVisible();
      }

      await expect(page.getByText(/^Error:/i).first()).not.toBeVisible();
      expect(mocks.lastPrompt()).toContain(scenario.prompt);
    });
  }

  test("preserves context across a follow-up deployment question", async ({ page }) => {
    await installCaipeMocks(page);

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await submitPrompt(page, "Validate multi-turn session persistence for GRID prod 0.5.x deployment testing");
    await expect(page.getByText(/Session context preserved/i).last()).toBeVisible();

    await submitPrompt(page, "Based on the previous deployment validation, which run ID should we keep investigating?");
    await expect(page.getByText(/wfrun-grid-prod-05x/i).last()).toBeVisible();
    await expect(page.getByText(/^Error:/i).first()).not.toBeVisible();
  });
});

async function submitPrompt(page: Page, prompt: string) {
  await page.getByPlaceholder(/Ask CAIPE anything|Ask anything/i).first().fill(prompt);
  await page.getByTitle("Send message").click();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
