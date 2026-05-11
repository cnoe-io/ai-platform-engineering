// assisted-by Codex Codex-sonnet-4-6

export const WEATHER_APP_ID = "weather";

export const WEATHER_MANIFEST = {
  id: WEATHER_APP_ID,
  displayName: "Weather Lab",
  description:
    "A real Open-Meteo powered reference app with forecast, air quality, national alert context, embedded weather actions, charts, and CAIPE context sharing.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/weather",
    chrome: "iframe",
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
    tokenScopes: ["weather:read", "weather:agent", "agents:invoke"],
    canUseCustomAgents: true,
    policyActions: [
      {
        action: "app.proxy.request",
        description: "Forward Weather app requests",
        defaultEffect: "deny",
      },
      {
        action: "proxy:POST",
        description: "Run embedded weather agent actions",
        defaultEffect: "allow",
      },
    ],
  },
  assistant: {
    enabled: true,
    schemaVersions: ["1.0"],
    maxContextBytes: 8192,
    capability: "contextual-chat",
    suggestions: true,
    label: "Ask Weather",
    agentName: "Weather Assistant",
  },
  agents: [
    {
      id: "weather-agent",
      displayName: "Weather Agent",
      required: false,
      capabilities: ["open-meteo-forecast", "air-quality-readout", "national-weather-alerts", "daily-guidance", "forecast-explanation", "chart-annotation"],
    },
  ],
  data: {
    apiBasePath: "/api/weather",
    eventChannels: ["weather.forecast.updated", "weather.agent.updated"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
    blockLaunchWhen: ["degraded", "unreachable"],
  },
  catalog: {
    categories: ["reference", "weather"],
    capabilities: ["open-meteo", "air-quality", "national-weather-alerts", "daily-guidance", "embedded-agent", "forecast-charts"],
  },
};
