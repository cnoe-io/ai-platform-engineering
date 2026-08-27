export const LITELLM_APP_ID = "litellm";

export const LITELLM_MANIFEST = {
  id: LITELLM_APP_ID,
  displayName: "LiteLLM Operations",
  description:
    "An MCP-backed operating dashboard for LiteLLM spend, tokens, requests, model mix, and optimization actions.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/litellm",
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
          default: "comfortable",
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
          key: "defaultRange",
          label: "Default usage range",
          type: "enum",
          default: "30d",
          options: [
            { label: "7 days", value: "7d" },
            { label: "30 days", value: "30d" },
            { label: "90 days", value: "90d" },
          ],
        },
      ],
    },
  },
  authorization: { resourceType: "agentic_app", launchAction: "use" },
  surfaces: {
    showInHub: true,
    showInTopNav: false,
    navOrder: 25,
    homeEligible: false,
    overlays: ["chat", "generative-ui"],
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["litellm:read", "litellm:agent:invoke", "agents:invoke"],
    canUseCustomAgents: true,
    policyActions: [
      {
        action: "proxy:GET",
        description: "Read LiteLLM dashboard pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["litellm:read"],
      },
      {
        action: "proxy:HEAD",
        description: "Probe LiteLLM dashboard pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["litellm:read"],
      },
      {
        action: "agent.invoke.litellm-finops",
        description: "Invoke the configured LiteLLM MCP reporting agent",
        defaultEffect: "allow",
        requiredScopes: ["litellm:agent:invoke", "agents:invoke"],
      },
    ],
  },
  assistant: {
    enabled: true,
    agentId: "agent-litellm-finops",
    schemaVersions: ["1.0"],
    maxContextBytes: 12288,
    capability: "contextual-chat",
    suggestions: true,
    label: "Ask LiteLLM",
    agentName: "LiteLLM Assistant",
  },
  agents: [
    {
      id: "litellm-finops-agent",
      displayName: "LiteLLM FinOps Agent",
      required: true,
      dynamicAgentId: "agent-litellm-finops",
      capabilities: [
        "litellm-mcp",
        "usage-reporting",
        "spend-analysis",
        "model-mix",
        "optimization-recommendations",
      ],
    },
  ],
  data: {
    apiBasePath: "/api/litellm",
    eventChannels: ["litellm.usage.updated", "litellm.agent.analysis.completed"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
    blockLaunchWhen: ["degraded", "unreachable"],
  },
  catalog: {
    categories: ["finops", "llm-operations", "litellm"],
    capabilities: [
      "litellm-mcp",
      "usage-reporting",
      "spend-analysis",
      "token-analysis",
      "assistant-context-bridge",
    ],
  },
};
