// assisted-by Codex Codex-sonnet-4-6

export const JIRA_PROJECT_DASHBOARD_APP_ID = "jira-project-dashboard";

export const JIRA_PROJECT_DASHBOARD_MANIFEST = {
  id: JIRA_PROJECT_DASHBOARD_APP_ID,
  displayName: "Jira Project Dashboard",
  description:
    "A Jira project command center for sprint health, blockers, at-risk work, owner asks, and structured project recommendations from a CAIPE Jira agent.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/jira-project-dashboard",
    chrome: "iframe",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: false,
    navOrder: 41,
    homeEligible: false,
    overlays: ["chat", "generative-ui"],
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["jira-project-dashboard:read", "jira-project-dashboard:agent:invoke", "agents:invoke"],
    canUseCustomAgents: true,
    policyActions: [
      {
        action: "app.proxy.request",
        description: "Forward Jira Project Dashboard app requests",
        defaultEffect: "deny",
      },
      {
        action: "proxy:POST",
        description: "Run embedded Jira project agent",
        defaultEffect: "allow",
      },
    ],
  },
  assistant: {
    enabled: true,
    schemaVersions: ["1.0"],
    maxContextBytes: 12288,
    capability: "contextual-chat",
    suggestions: true,
    label: "Ask Jira Ops",
    agentName: "Jira Ops Assistant",
  },
  agents: [
    {
      id: "jira-agent",
      displayName: "Jira Agent",
      required: false,
      capabilities: ["jira-issues", "sprint-summary", "blocker-analysis", "project-risk"],
    },
  ],
  data: {
    apiBasePath: "/api/jira-project-dashboard",
    eventChannels: ["jira-project-dashboard.dashboard.updated", "jira-project-dashboard.agent.updated"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
    blockLaunchWhen: ["degraded", "unreachable"],
  },
  catalog: {
    categories: ["project-management", "jira"],
    capabilities: ["jira-issues", "sprint-summary", "blocker-analysis", "embedded-agent", "action-cards", "structured-output"],
  },
};
