// assisted-by Codex Codex-sonnet-4-6

export const FINOPS_APP_ID = "finops";

export const FINOPS_MANIFEST = {
  id: FINOPS_APP_ID,
  displayName: "FinOps Command Center",
  description:
    "A real-data reference app that launches AWS Cost Explorer and LiteLLM usage analysis through FinOps agents and shares cost context with the CAIPE Assistant Overlay.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/finops",
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
          key: "defaultRange",
          label: "Default cost range",
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
    navOrder: 20,
    homeEligible: false,
    overlays: ["chat"],
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["finops:read", "finops:agent:invoke", "agents:invoke"],
    canUseCustomAgents: true,
    policyActions: [
      {
        action: "proxy:GET",
        description: "Read FinOps pages and data through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["finops:read"],
      },
      {
        action: "proxy:HEAD",
        description: "Probe FinOps pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["finops:read"],
      },
      {
        action: "proxy:POST",
        description: "Run FinOps actions through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["finops:agent:invoke"],
      },
      {
        action: "agent.invoke.aws-cost-explorer",
        description: "Invoke the configured AWS cost analysis agent",
        defaultEffect: "allow",
        requiredScopes: ["finops:agent:invoke", "agents:invoke"],
      },
      {
        action: "agent.invoke.litellm-finops",
        description: "Invoke the configured LiteLLM FinOps reporting agent",
        defaultEffect: "allow",
        requiredScopes: ["finops:agent:invoke", "agents:invoke"],
      },
    ],
  },
  assistant: {
    enabled: true,
    agentId: "agent-finops",
    schemaVersions: ["1.0"],
    maxContextBytes: 8192,
    capability: "contextual-chat",
    suggestions: true,
    label: "Ask FinOps",
    agentName: "FinOps Assistant",
  },
  agents: [
    {
      id: "finops-agent",
      displayName: "FinOps Agent",
      required: true,
      dynamicAgentId: "agent-finops",
      capabilities: ["aws-cost-explorer", "litellm-usage-reporting", "cost-anomaly-explanation", "savings-recommendation"],
    },
  ],
  data: {
    apiBasePath: "/api/finops",
    eventChannels: ["finops.cost.updated", "finops.litellm.updated", "finops.agent.analysis.completed"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
    blockLaunchWhen: ["degraded", "unreachable"],
  },
  catalog: {
    categories: ["reference", "finops", "aws", "litellm"],
    capabilities: ["aws-cost-explorer", "litellm-usage-reporting", "assistant-context-bridge", "optimization-workflows"],
  },
};
