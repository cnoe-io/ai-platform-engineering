// assisted-by Codex Codex-sonnet-4-6

export const FINOPS_APP_ID = "finops";

export const FINOPS_MANIFEST = {
  id: FINOPS_APP_ID,
  displayName: "FinOps Command Center",
  description:
    "A real-data reference app that launches AWS Cost Explorer analysis through a custom AWS agent and shares cost context with the CAIPE Assistant Overlay.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/finops",
    chrome: "iframe",
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
    tokenScopes: ["finops:read", "finops:agent:invoke", "agents:invoke"],
    canUseCustomAgents: true,
    policyActions: [
      {
        action: "app.proxy.request",
        description: "Forward FinOps app requests",
        defaultEffect: "deny",
      },
      {
        action: "agent.invoke.aws-cost-explorer",
        description: "Invoke the configured AWS cost analysis agent",
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
    label: "Ask FinOps",
    agentName: "FinOps Assistant",
  },
  agents: [
    {
      id: "finops-agent",
      displayName: "FinOps Agent",
      required: true,
      capabilities: ["aws-cost-explorer", "cost-anomaly-explanation", "savings-recommendation"],
    },
  ],
  data: {
    apiBasePath: "/api/finops",
    eventChannels: ["finops.cost.updated", "finops.agent.analysis.completed"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
    blockLaunchWhen: ["degraded", "unreachable"],
  },
  catalog: {
    categories: ["reference", "finops", "aws"],
    capabilities: ["aws-cost-explorer", "assistant-context-bridge", "optimization-workflows"],
  },
};
