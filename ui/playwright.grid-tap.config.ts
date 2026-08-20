import { defineConfig, devices } from "@playwright/test";

function artifactSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
}

const artifactRun = artifactSegment(process.env.GRID_TAP_RUN_ID || "local");
const artifactMode = artifactSegment(process.env.GRID_TAP_MODE || "direct");
const artifactRoot = `test-results/grid-tap/${artifactRun}/${artifactMode}`;
const reportRoot = `playwright-report/grid-tap/${artifactRun}/${artifactMode}`;

export default defineConfig({
  testDir: "./e2e/grid-tap",
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  outputDir: artifactRoot,
  reporter: [
    ["list"],
    ["junit", { outputFile: `${artifactRoot}/results.xml` }],
    ["json", { outputFile: `${artifactRoot}/results.json` }],
    ["html", { outputFolder: reportRoot, open: "never" }],
  ],
  use: {
    baseURL: process.env.GRID_TAP_BASE_URL ?? "https://example.test",
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "grid-tap-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
