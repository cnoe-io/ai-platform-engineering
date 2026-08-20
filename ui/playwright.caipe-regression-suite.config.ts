import { defineConfig, devices } from "@playwright/test";

function artifactSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
}

const artifactRun = artifactSegment(process.env.CAIPE_REGRESSION_SUITE_RUN_ID || "local");
const artifactMode = artifactSegment(process.env.CAIPE_REGRESSION_SUITE_MODE || "direct");
const artifactRoot = `test-results/caipe-regression-suite/${artifactRun}/${artifactMode}`;
const reportRoot = `playwright-report/caipe-regression-suite/${artifactRun}/${artifactMode}`;

export default defineConfig({
  testDir: "./e2e/caipe-regression-suite",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: artifactRoot,
  reporter: [
    ["list"],
    ["junit", { outputFile: `${artifactRoot}/results.xml` }],
    ["json", { outputFile: `${artifactRoot}/results.json` }],
    ["html", { outputFolder: reportRoot, open: "never" }],
  ],
  use: {
    baseURL: process.env.CAIPE_REGRESSION_SUITE_BASE_URL ?? "https://example.test",
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "caipe-regression-suite-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
