// assisted-by Codex Codex-sonnet-4-6

import type { AgenticAppManifest } from "@/types/agentic-app";
import { FINOPS_APP_ID, FINOPS_MANIFEST, WEATHER_MANIFEST } from "./sample-manifests";

/**
 * Built-in marketplace rows (metadata + validated manifest shape only).
 * Host-specific runtime fields such as `origin` are applied at read time in `registry.ts` / gateway code.
 */

export const AGENTIC_SDLC_APP_ID = "agentic-sdlc";

export const AGENTIC_SDLC_MANIFEST: AgenticAppManifest = {
  id: AGENTIC_SDLC_APP_ID,
  displayName: "Agentic SDLC",
  description:
    "Spec-driven development, ship loop coordination, and SDLC workflows integrated with CAIPE agents.",
  apiVersion: "1.0",
  runtime: {
    kind: "in-process",
    mountPath: "/apps/agentic-sdlc",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: true,
    navOrder: 5,
    homeEligible: true,
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["agents:invoke"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 2000,
  },
};

export const BUILTIN_AGENTIC_APP_PACKAGE_SEEDS = [
  {
    packageId: FINOPS_APP_ID,
    source: "builtin" as const,
    manifest: FINOPS_MANIFEST,
    catalog: {
      categories: ["finops", "cost"],
      capabilities: ["cost-summary", "anomaly-explanation"],
    },
  },
  {
    packageId: "agentic-sdlc",
    source: "builtin" as const,
    manifest: AGENTIC_SDLC_MANIFEST,
    catalog: {
      categories: ["sdlc", "platform"],
      capabilities: ["spec", "ship-loop"],
    },
  },
  {
    packageId: "weather",
    source: "builtin" as const,
    manifest: WEATHER_MANIFEST,
    catalog: {
      categories: ["starter", "weather", "copilotkit"],
      capabilities: ["ag-ui-layout", "copilotkit-action", "forecast-summary"],
    },
  },
] as const;
