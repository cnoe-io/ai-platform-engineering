// assisted-by Codex Codex-sonnet-4-6

import {
  AGENTIC_SDLC_APP_ID,
  AGENTIC_SDLC_MANIFEST,
} from "../../../apps/agentic-sdlc/manifest.mjs";
import {
  FINOPS_APP_ID,
  FINOPS_MANIFEST,
} from "../../../apps/agentic-apps/finops/manifest.mjs";
import {
  WEATHER_APP_ID,
  WEATHER_MANIFEST,
} from "../../../apps/agentic-apps/weather/manifest.mjs";
import {
  OSS_REPO_MANAGEMENT_APP_ID,
  OSS_REPO_MANAGEMENT_MANIFEST,
} from "../../../apps/agentic-apps/oss-repo-management/manifest.mjs";
import {
  JIRA_PROJECT_DASHBOARD_APP_ID,
  JIRA_PROJECT_DASHBOARD_MANIFEST,
} from "../../../apps/agentic-apps/jira-project-dashboard/manifest.mjs";
import {
  LITELLM_APP_ID,
  LITELLM_MANIFEST,
} from "../../../apps/agentic-apps/litellm/manifest.mjs";
import {
  SPEAKERS_COLLECTIVE_APP_ID,
  SPEAKERS_COLLECTIVE_MANIFEST,
} from "../../../apps/agentic-apps/speakers-collective/manifest.mjs";

/**
 * Built-in marketplace rows (metadata + validated manifest shape only).
 * Host-specific runtime fields such as `origin` are applied at read time in `registry.ts` / gateway code.
 */

export { AGENTIC_SDLC_APP_ID, AGENTIC_SDLC_MANIFEST };

export const BUILTIN_AGENTIC_APP_PACKAGE_SEEDS = [
  {
    packageId: AGENTIC_SDLC_APP_ID,
    source: "builtin" as const,
    manifest: AGENTIC_SDLC_MANIFEST,
    catalog: {
      categories: ["sdlc", "platform"],
      capabilities: ["spec", "ship-loop"],
    },
  },
  {
    packageId: FINOPS_APP_ID,
    source: "builtin" as const,
    manifest: FINOPS_MANIFEST,
    catalog: {
      categories: ["reference", "finops", "aws", "litellm"],
      capabilities: ["aws-cost-explorer", "litellm-usage-reporting", "assistant-context-bridge"],
    },
  },
  {
    packageId: WEATHER_APP_ID,
    source: "builtin" as const,
    manifest: WEATHER_MANIFEST,
    catalog: {
      categories: ["reference", "weather"],
      capabilities: ["open-meteo", "embedded-agent", "forecast-charts"],
    },
  },
  {
    packageId: LITELLM_APP_ID,
    source: "builtin" as const,
    manifest: LITELLM_MANIFEST,
    catalog: {
      categories: ["finops", "llm-operations", "litellm"],
      capabilities: ["litellm-mcp", "usage-reporting", "spend-analysis", "assistant-context-bridge"],
    },
  },
  {
    packageId: OSS_REPO_MANAGEMENT_APP_ID,
    source: "builtin" as const,
    manifest: OSS_REPO_MANAGEMENT_MANIFEST,
    catalog: {
      categories: ["oss", "github", "repo-management"],
      capabilities: ["github-issues", "pull-request-context", "embedded-agent", "action-cards", "structured-output"],
    },
  },
  {
    packageId: JIRA_PROJECT_DASHBOARD_APP_ID,
    source: "builtin" as const,
    manifest: JIRA_PROJECT_DASHBOARD_MANIFEST,
    catalog: {
      categories: ["project-management", "jira"],
      capabilities: ["jira-issues", "sprint-summary", "blocker-analysis", "embedded-agent", "action-cards", "structured-output"],
    },
  },
  {
    packageId: SPEAKERS_COLLECTIVE_APP_ID,
    source: "builtin" as const,
    manifest: SPEAKERS_COLLECTIVE_MANIFEST,
    catalog: {
      categories: ["community", "events", "speaking"],
      capabilities: ["cfp-discovery", "deadline-tracking", "team-filtering", "assistant-context-bridge"],
    },
  },
] as const;
