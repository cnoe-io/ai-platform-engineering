import { expect, test } from "@playwright/test";
import { expectAppReady, installCaipeMocks } from "./fixtures/a2a-mocks";

test.describe("Use cases and settings", () => {
  test.fixme("surfaces requested SRE scenarios in the use-case grid", async ({ page }) => {
    await installCaipeMocks(page);

    await page.goto("/use-cases", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await expect(page.getByRole("heading", { name: "Use Cases Gallery" })).toBeVisible();
    await expect(page.getByText("Review Open Pull Requests").first()).toBeVisible();
    await expect(page.getByText("Review a Specific PR").first()).toBeVisible();
    await expect(page.getByText("Incident Investigation").first()).toBeVisible();
    await expect(page.getByText("AWS Cost Analysis").first()).toBeVisible();
    await expect(page.getByText("Release Readiness Check").first()).toBeVisible();
    await expect(page.getByText(/Task Builder/i)).toHaveCount(0);
  });

  test.fixme("launches GitHub PR review from the use-case grid", async ({ page }) => {
    const mocks = await installCaipeMocks(page);

    await page.goto("/use-cases", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await page.getByText("Review Open Pull Requests").first().click();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByText(/List all open pull requests/i)).toBeVisible();
    await expect(page.getByText(/GitHub Debug Summary/i)).toBeVisible();
    expect(mocks.lastPrompt()).toContain("open pull requests");
    expect(mocks.lastPrompt()).toContain("failing checks");
  });

  test.fixme("filters use cases by integration", async ({ page }) => {
    await installCaipeMocks(page);

    await page.goto("/use-cases", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await page.getByPlaceholder(/Search use cases/i).fill("PagerDuty");

    await expect(page.getByText("Incident Investigation").first()).toBeVisible();
    await expect(page.getByText("On-Call Handoff").first()).toBeVisible();
    await expect(page.getByText("AWS Cost Analysis").first()).toHaveCount(0);
  });

  test.fixme("creates a custom platform scenario from the use-case builder", async ({ page }) => {
    await installCaipeMocks(page);

    await page.goto("/use-cases", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await page.getByRole("button", { name: /Create Use Case/i }).click();
    await expect(page.getByRole("dialog", { name: /Use Case Builder/i })).toBeVisible();

    await page.getByPlaceholder(/Check Deployment Status/i).fill("SRE Webex Incident Broadcast");
    await page.getByPlaceholder(/Brief description/i).fill("Summarize an incident and notify the SRE Webex team space.");
    await page.getByPlaceholder(/Enter the system prompt/i).fill("Summarize active incidents, include PagerDuty owner, Splunk signal, and post to Webex.");
    await page.getByLabel("PagerDuty").check();
    await page.getByLabel("Splunk").check();
    await page.getByLabel("DevOps & Operations").check();
    await page.getByLabel("Advanced").check();
    await page.getByPlaceholder(/Kubernetes, ArgoCD, Monitoring/i).fill("PagerDuty, Splunk, Webex");
    await page.getByRole("button", { name: /Save Use Case/i }).click();

    await expect(page.getByText(/Use case saved successfully/i)).toBeVisible();
  });

  test("opens the Workflows route that replaces Task Builder", async ({ page }) => {
    await installCaipeMocks(page);

    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Workflows" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Create Workflow/i })).toBeVisible();
    await expect(page.getByText(/Task Builder/i)).toHaveCount(0);
  });

  test("spot checks available settings controls", async ({ page }) => {
    await installCaipeMocks(page);

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await page.getByTitle("UI Personalization").click();

    await expect(page.getByRole("heading", { name: "UI Personalization" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Font Size" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gradient Theme" })).toBeVisible();

    const fontSizeSection = page.getByRole("heading", { name: "Font Size" }).locator("xpath=ancestor::section");
    await fontSizeSection.getByRole("button", { name: /^Large\b/i }).click();

    const gradientSection = page.getByRole("heading", { name: "Gradient Theme" }).locator("xpath=ancestor::section");
    await gradientSection.getByRole("button", { name: /^Professional/i }).click();

    await expect(page.locator("body")).toHaveAttribute("data-font-size", "large");
    await expect(page.locator("html")).toHaveAttribute("data-gradient-theme", "professional");
  });
});
