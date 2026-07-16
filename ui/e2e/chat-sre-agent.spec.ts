import { expect, test } from "@playwright/test";
import { expectAppReady, installCaipeMocks } from "./fixtures/a2a-mocks";

const sreScenarios = [
  {
    name: "Basic Outshift SRE triage",
    prompt: "Run basic Outshift SRE triage across GitHub, ArgoCD, AWS, PagerDuty, and Splunk",
    expected: /Outshift SRE Debug Summary/i,
  },
  {
    name: "ArgoCD deployment debugging",
    prompt: "@argocd show argocd version and unhealthy production applications",
    expected: /ArgoCD version is/i,
  },
  {
    name: "GitHub pull request debugging",
    prompt: "@github list open PRs and failing workflow checks for https://github.com/cnoe-io/ai-platform-engineering/pulls",
    expected: /GitHub Debug Summary/i,
  },
  {
    name: "AWS infrastructure debugging",
    prompt: "@aws check EKS health, CloudWatch alarms, and cost anomalies",
    expected: /AWS Debug Summary/i,
  },
  {
    name: "PagerDuty incident debugging",
    prompt: "@pagerduty show active incidents and current on-call owner",
    expected: /PagerDuty Incident Summary/i,
  },
  {
    name: "Splunk log debugging",
    prompt: "@splunk search recent 5xx errors in platform services",
    expected: /Splunk Log Search/i,
  },
  {
    name: "Webex team space update",
    prompt: "@webex post an incident summary to the team space",
    expected: /Webex Update/i,
  },
];

test.describe("Chat with SRE Agent", () => {
  for (const scenario of sreScenarios) {
    test(scenario.name, async ({ page }) => {
      const mocks = await installCaipeMocks(page);

      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      await expectAppReady(page);

      await page.getByPlaceholder(/Ask CAIPE anything|Ask anything/i).fill(scenario.prompt);
      await page.getByTitle("Send message").click();

      await expect(page.getByText(scenario.prompt)).toBeVisible();
      await expect(page.getByText(scenario.expected)).toBeVisible();
      await expect(page.getByText(/^Error:/i).first()).not.toBeVisible();
      expect(mocks.lastPrompt()).toContain(scenario.prompt);
    });
  }

  test.fixme("agent mention menu exposes core SRE integrations", async ({ page }) => {
    await installCaipeMocks(page);

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await page.getByPlaceholder(/Ask CAIPE anything|Ask anything/i).fill("@");

    await expect(page.getByText("Select an agent:")).toBeVisible();
    await expect(page.getByRole("button", { name: /ArgoCD @argocd/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /AWS @aws/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /GitHub @github/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Splunk @splunk/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /PagerDuty @pagerduty/i })).toBeVisible();

    await page.getByPlaceholder(/Ask CAIPE anything|Ask anything/i).fill("@web");
    await expect(page.getByRole("button", { name: /@webex/i })).toBeVisible();
  });

  test.fixme("use-case gallery launches multi-agent incident investigation chat", async ({ page }) => {
    const mocks = await installCaipeMocks(page);

    await page.goto("/use-cases", { waitUntil: "domcontentloaded" });
    await expectAppReady(page);

    await page.getByRole("button", { name: /Incident Investigation/i }).first().click();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByText(/Show me active PagerDuty incidents/i)).toBeVisible();
    await expect(page.getByText(/PagerDuty Incident Summary/i)).toBeVisible();
    expect(mocks.lastPrompt()).toContain("active PagerDuty incidents");
    expect(mocks.lastPrompt()).toContain("recent deployments");
  });
});
