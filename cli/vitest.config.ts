import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@platform": "./src/platform",
      "@auth": "./src/auth",
      "@chat": "./src/chat",
      "@skills": "./src/skills",
      "@agents": "./src/agents",
      "@memory": "./src/memory",
      "@commit": "./src/commit",
      "@headless": "./src/headless",
    },
  },
});
