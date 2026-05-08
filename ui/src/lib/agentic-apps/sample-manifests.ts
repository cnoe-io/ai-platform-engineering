// assisted-by Codex Codex-sonnet-4-6

import type { AgenticAppManifest } from "@/types/agentic-app";

export const FINOPS_APP_ID = "finops";
export const WEATHER_APP_ID = "weather";

export const FINOPS_MANIFEST: AgenticAppManifest = {
  id: FINOPS_APP_ID,
  displayName: "FinOps Dashboard",
  description:
    "A sample separately deployed agentic app for cloud spend, anomalies, and optimization workflows.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/finops",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: false,
    navOrder: 20,
    homeEligible: false,
    overlays: ["chat"],
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["finops:read", "agents:invoke"],
    canUseCustomAgents: true,
  },
  agents: [
    {
      id: "finops-analyst",
      displayName: "FinOps Analyst",
      required: false,
      capabilities: ["cost-summary", "anomaly-explanation", "savings-plan-recommendation"],
    },
  ],
  data: {
    apiBasePath: "/api/finops",
    eventChannels: ["finops.cost.updated"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
  },
};

export const WEATHER_MANIFEST: AgenticAppManifest = {
  id: WEATHER_APP_ID,
  displayName: "Weather Starter",
  description:
    "A CopilotKit and AG-UI-first starter app for agent-rendered weather cards and workflow suggestions.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/weather",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: false,
    navOrder: 30,
    homeEligible: false,
    overlays: ["chat", "generative-ui"],
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["weather:read", "agents:invoke"],
    canUseCustomAgents: true,
  },
  agents: [
    {
      id: "weather-advisor",
      displayName: "Weather Advisor",
      required: false,
      capabilities: ["forecast-summary", "travel-planning", "weather-alert-explanation"],
    },
  ],
  data: {
    apiBasePath: "/api/weather",
    eventChannels: ["weather.forecast.updated", "weather.alert.updated"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
  },
};
