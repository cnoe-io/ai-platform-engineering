import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "chat-sre-agent.spec.ts",
    "use-cases-and-settings.spec.ts",
    "roadmap-coverage.spec.ts",
  ],
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html"], ["github"]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_A2A_BASE_URL: process.env.NEXT_PUBLIC_A2A_BASE_URL || "http://localhost:8000",
          NEXT_PUBLIC_CAIPE_URL: process.env.NEXT_PUBLIC_CAIPE_URL || "http://localhost:8000",
          NEXT_PUBLIC_SSO_ENABLED: process.env.NEXT_PUBLIC_SSO_ENABLED || "false",
          NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS: process.env.NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS || "true",
        },
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
