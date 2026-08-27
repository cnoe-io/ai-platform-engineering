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
  ui: {
    contractVersion: "1.0",
    surface: "hosted",
    routes: ["/", "/example"],
    preferences: {
      schemaVersion: "1.0",
      fields: [
        {
          key: "density",
          label: "Dashboard density",
          type: "enum",
          default: "compact",
          options: [
            { label: "Compact", value: "compact" },
            { label: "Comfortable", value: "comfortable" },
          ],
        },
        {
          key: "textScale",
          label: "Text size",
          type: "enum",
          default: "default",
          options: [
            { label: "Small", value: "small" },
            { label: "Default", value: "default" },
            { label: "Large", value: "large" },
            { label: "Extra large", value: "xl" },
          ],
        },
        {
          key: "units",
          label: "Weather units",
          type: "enum",
          default: "us",
          options: [
            { label: "US customary", value: "us" },
            { label: "Metric", value: "metric" },
          ],
        },
      ],
    },
  },
  authorization: { resourceType: "agentic_app", launchAction: "use" },
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
        action: "proxy:GET",
        description: "Read Weather pages and provider data through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["weather:read"],
      },
      {
        action: "proxy:HEAD",
        description: "Probe Weather pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["weather:read"],
      },
      {
        action: "proxy:POST",
        description: "Run embedded weather agent actions",
        defaultEffect: "allow",
        requiredScopes: ["weather:agent"],
      },
      {
        action: "agent.invoke.weather",
        description: "Invoke the configured Weather agent",
        defaultEffect: "allow",
        requiredScopes: ["weather:agent", "agents:invoke"],
      },
    ],
  },
  assistant: {
    enabled: true,
    agentId: "agent-weather-agent",
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
      required: true,
      dynamicAgentId: "agent-weather-agent",
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
