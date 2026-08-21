import { expect, test, type Page } from "@playwright/test";

import { installTestSession } from "./_helpers";

type ReviewPage = {
  path: string;
  oldBody: string;
  newBody: string;
  isNewPage: boolean;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Tome review live E2E`);
  return value;
}

async function dismissBlockingDialogs(page: Page): Promise<void> {
  const releaseDialog = page.getByRole("dialog", { name: /what's new in/i });
  if (await releaseDialog.waitFor({ state: "visible", timeout: 3_000 }).then(
    () => true,
    () => false,
  )) {
    await releaseDialog.getByRole("button", { name: "Skip until next login" }).click();
    await expect(releaseDialog).toBeHidden();
  }

  const onboardingDialog = page.getByRole("dialog").filter({
    has: page.getByRole("img", { name: "TOME" }),
  });
  if (await onboardingDialog.waitFor({ state: "visible", timeout: 3_000 }).then(
    () => true,
    () => false,
  )) {
    await onboardingDialog.getByRole("button", { name: "Close" }).click();
    await expect(onboardingDialog).toBeHidden();
  }
}

test("rejected-only page history renders as a new page", async ({ page }, testInfo) => {
  test.skip(
    process.env.RUN_TOME_REVIEW_E2E !== "1",
    "RUN_TOME_REVIEW_E2E must opt in to the deployed Tome review regression",
  );

  const baseUrl = requiredEnv("CAIPE_UI_BASE_URL");
  const slug = requiredEnv("TOME_REVIEW_E2E_PROJECT_SLUG");
  const runId = requiredEnv("TOME_REVIEW_E2E_RUN_ID");
  const expectedPath = requiredEnv("TOME_REVIEW_E2E_PAGE_PATH");
  const adminEmail = requiredEnv("TOME_REVIEW_E2E_ADMIN_EMAIL");
  requiredEnv("NEXTAUTH_SECRET");

  await installTestSession(
    page,
    {
      baseUrl,
      keycloakUrl: baseUrl,
      keycloakRealm: "example",
      user: { email: adminEmail, password: "unused" },
    },
    {
      email: adminEmail,
      subject: "tome-review-e2e-admin",
      role: "admin",
    },
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const reviewUrl = `/api/tome/projects/${encodeURIComponent(slug)}/ingests/${encodeURIComponent(runId)}/review`;
  const reviewResult = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, reviewUrl);
  await testInfo.attach("review-response.json", {
    body: JSON.stringify(reviewResult, null, 2),
    contentType: "application/json",
  });

  expect(reviewResult.status, JSON.stringify(reviewResult.body)).toBe(200);
  const pages = (reviewResult.body as { data?: { pages?: ReviewPage[] } }).data?.pages ?? [];
  const reviewedPage = pages.find((candidate) => candidate.path === expectedPath);
  expect(reviewedPage).toEqual(expect.objectContaining({
    path: expectedPath,
    oldBody: "",
    isNewPage: true,
  }));

  await page.goto(
    `/projects/${encodeURIComponent(slug)}/tome/ingest/${encodeURIComponent(runId)}/review`,
    { waitUntil: "domcontentloaded" },
  );
  await dismissBlockingDialogs(page);
  const pageButton = page.getByRole("button", { name: new RegExp(expectedPath, "i") });
  await expect(pageButton.getByText("new", { exact: true })).toBeVisible();
  await expect(page.getByText("(new page)", { exact: true })).toBeVisible();
  await testInfo.attach("review-page.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
