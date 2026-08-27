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
  ui: {
    contractVersion: "1.0",
    surface: "hosted",
    routes: ["/"],
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
      ],
    },
  },
  authorization: { resourceType: "agentic_app", launchAction: "use" },
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
        action: "proxy:GET",
        description: "Read Jira dashboard pages and data through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["jira-project-dashboard:read"],
      },
      {
        action: "proxy:HEAD",
        description: "Probe Jira dashboard pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["jira-project-dashboard:read"],
      },
      {
        action: "proxy:POST",
        description: "Run embedded Jira project agent",
        defaultEffect: "allow",
        requiredScopes: ["jira-project-dashboard:agent:invoke"],
      },
    ],
  },
  assistant: {
    enabled: true,
    agentId: "agent-jira-agent",
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
      required: true,
      dynamicAgentId: "agent-jira-agent",
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
