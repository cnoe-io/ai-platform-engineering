/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("agentic app docker compose wiring", () => {
  it("runs embedded app runtimes as first-class dev compose services", () => {
    const repoRoot = join(process.cwd(), "..");
    const compose = readFileSync(join(repoRoot, "docker-compose.dev.yaml"), "utf8");
    const dockerfilePath = join(repoRoot, "build/Dockerfile.agentic-app");

    expect(existsSync(dockerfilePath)).toBe(true);
    expect(compose).toContain("agentic-app-finops:");
    expect(compose).toContain("agentic-app-weather:");
    expect(compose).toContain("agentic-app-oss-repo-management:");
    expect(compose).toContain("agentic-app-jira-project-dashboard:");
    expect(compose).toContain("AGENTIC_APPS_ENABLED=${CAIPE_UI_AGENTIC_APPS_ENABLED:-agentic-sdlc,finops,weather,oss-repo-management,jira-project-dashboard}");
    expect(compose).toContain("AGENTIC_APP_FINOPS_ORIGIN=${CAIPE_UI_AGENTIC_APP_FINOPS_ORIGIN:-http://agentic-app-finops:3010}");
    expect(compose).toContain("AGENTIC_APP_WEATHER_ORIGIN=${CAIPE_UI_AGENTIC_APP_WEATHER_ORIGIN:-http://agentic-app-weather:3020}");
    expect(compose).toContain("AGENTIC_APP_OSS_REPO_MANAGEMENT_ORIGIN=${CAIPE_UI_AGENTIC_APP_OSS_REPO_MANAGEMENT_ORIGIN:-http://agentic-app-oss-repo-management:3040}");
    expect(compose).toContain("AGENTIC_APP_JIRA_PROJECT_DASHBOARD_ORIGIN=${CAIPE_UI_AGENTIC_APP_JIRA_PROJECT_DASHBOARD_ORIGIN:-http://agentic-app-jira-project-dashboard:3041}");
    expect(compose).toContain("RAG_SERVER_URL=${CAIPE_UI_RAG_SERVER_URL:-http://rag_server:9446}");
    expect(compose).toContain("RAG_URL=${CAIPE_UI_RAG_URL:-http://rag_server:9446}");
    expect(compose).toContain("DYNAMIC_AGENTS_URL=${CAIPE_UI_DYNAMIC_AGENTS_URL:-http://dynamic-agents:8001}");
    expect(compose).toContain("MONGODB_URI=${CAIPE_UI_MONGODB_URI:-mongodb://admin:changeme@caipe-mongodb:27017/caipe?authSource=admin}");
    expect(compose).toContain("APP_CONFIG_PATH=/config/app-config.yaml");
    expect(compose).toContain("./config/agentic-apps:/config/agentic-apps:ro");
  });

  it("runs caipe-ui with Next.js dev hot reload in the local compose profile", () => {
    const repoRoot = join(process.cwd(), "..");
    const compose = readFileSync(join(repoRoot, "docker-compose.dev.yaml"), "utf8");
    const dockerfile = readFileSync(join(repoRoot, "build/Dockerfile.caipe-ui"), "utf8");

    expect(dockerfile).toContain("FROM deps AS dev");
    expect(compose).toContain("target: dev");
    expect(compose).toContain("NODE_ENV=development");
    expect(compose).toContain("NEXT_TELEMETRY_DISABLED=1");
    expect(compose).toContain("WATCHPACK_POLLING=${CAIPE_UI_WATCHPACK_POLLING:-true}");
    expect(compose).toContain('command: ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]');
    expect(compose).toContain("./ui:/app");
    expect(compose).toContain("/app/node_modules");
    expect(compose).toContain("/app/.next");
  });
});
