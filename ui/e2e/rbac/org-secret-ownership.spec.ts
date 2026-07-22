// assisted-by claude code claude-sonnet-4-6

import { expect, test } from "@playwright/test";

import { forceCredentialsFeatureFlags, gotoPersonalCredentialsSecrets, installCredentialsBrowserMocks } from "./_credentials-browser-fixtures";
import type { CredentialSecretFixture } from "./_credentials-browser-fixtures";
import { mockedRbacEnabled } from "./_mocked-rbac";

test.beforeEach(() => {
  if (!mockedRbacEnabled()) test.skip();
});

const ORG_SECRET: CredentialSecretFixture = {
  id: "secret-org-thousandeyes",
  name: "ThousandEyes API token",
  type: "bearer_token",
  owner: {
    type: "organization",
    id: "example-org",
  },
  maskedPreview: "eye_...abcd",
  sharedWithTeams: [],
};

test.describe("org-level secret ownership", () => {
  test("create dialog shows Save as organization secret checkbox", async ({ page }) => {
    await forceCredentialsFeatureFlags(page);
    await installCredentialsBrowserMocks(page);
    await gotoPersonalCredentialsSecrets(page);

    await page.getByRole("button", { name: /new secret/i }).click();
    await expect(page.getByText(/Save as organization secret/i)).toBeVisible();
  });

  test("checking org checkbox sends ownerType=organization in POST body", async ({ page }) => {
    const mocks = await installCredentialsBrowserMocks(page);
    await gotoPersonalCredentialsSecrets(page);

    const createRequests: Array<Record<string, unknown>> = [];
    await page.route("**/api/credentials/secrets", async (route) => {
      if (route.request().method() === "POST") {
        const body = await route.request().postDataJSON().catch(() => null);
        createRequests.push(body as Record<string, unknown>);
      }
      await route.continue();
    });

    await page.getByRole("button", { name: /new secret/i }).click();
    await page.getByLabel(/name/i).fill("Org-level test secret");
    await page.getByLabel(/value/i).fill("raw-token-value");
    await page.getByLabel(/Save as organization secret/i).check();
    await page.getByRole("button", { name: /save/i }).click();

    await expect(async () => {
      expect(createRequests.some((r) => r.ownerType === "organization")).toBe(true);
    }).toPass({ timeout: 5_000 });
    expect(mocks.personalCreateRequests.length).toBeGreaterThanOrEqual(1);
  });

  test("org-owned secrets show Organization badge in the list", async ({ page }) => {
    await installCredentialsBrowserMocks(page, {
      secrets: [ORG_SECRET],
    });
    await gotoPersonalCredentialsSecrets(page);

    await expect(page.getByText("ThousandEyes API token")).toBeVisible();
    await expect(page.getByText("Organization")).toBeVisible();
  });

  test("personal secret creation (unchecked) does not send ownerType", async ({ page }) => {
    await installCredentialsBrowserMocks(page);
    await gotoPersonalCredentialsSecrets(page);

    const createRequests: Array<Record<string, unknown>> = [];
    await page.route("**/api/credentials/secrets", async (route) => {
      if (route.request().method() === "POST") {
        const body = await route.request().postDataJSON().catch(() => null);
        createRequests.push(body as Record<string, unknown>);
      }
      await route.continue();
    });

    await page.getByRole("button", { name: /new secret/i }).click();
    await page.getByLabel(/name/i).fill("Personal test secret");
    await page.getByLabel(/value/i).fill("raw-token-value");
    // intentionally leave the org checkbox unchecked
    await page.getByRole("button", { name: /save/i }).click();

    await expect(async () => {
      expect(createRequests.length).toBeGreaterThan(0);
    }).toPass({ timeout: 5_000 });
    expect(createRequests.every((r) => !r.ownerType || r.ownerType === "user")).toBe(true);
  });

  test("org badge absent on user-owned secrets", async ({ page }) => {
    await installCredentialsBrowserMocks(page); // default secret is user-owned
    await gotoPersonalCredentialsSecrets(page);

    await expect(page.getByText("GitHub token")).toBeVisible();
    // The blue "Organization" badge should not appear for a user-owned secret
    await expect(page.locator("text=Organization").first()).not.toBeVisible();
  });
});
