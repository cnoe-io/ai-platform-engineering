// assisted-by Codex Codex-sonnet-4-6

export const OSS_REPO_MANAGEMENT_APP_ID = "oss-repo-management";

export const OSS_REPO_MANAGEMENT_MANIFEST = {
  id: OSS_REPO_MANAGEMENT_APP_ID,
  displayName: "OSS Repo Management",
  description:
    "A GitHub Issues and pull request command center for open source repository maintainers with embedded repository actions, structured outputs, live agent activity, and CAIPE context sharing.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/oss-repo-management",
    chrome: "iframe",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: false,
    navOrder: 40,
    homeEligible: false,
    overlays: ["chat", "generative-ui"],
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["oss-repo-management:read", "oss-repo-management:agent:invoke", "agents:invoke"],
    canUseCustomAgents: true,
    policyActions: [
      {
        action: "app.proxy.request",
        description: "Forward OSS Repo Management app requests",
        defaultEffect: "deny",
      },
      {
        action: "proxy:POST",
        description: "Run embedded GitHub repository agent",
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
    label: "Ask Repo",
    agentName: "Repo Assistant",
  },
  agents: [
    {
      id: "github-agent",
      displayName: "GitHub Agent",
      required: false,
      capabilities: ["github-issues", "pull-request-context", "repository-risk", "maintainer-actions"],
    },
  ],
  data: {
    apiBasePath: "/api/oss-repo-management",
    eventChannels: ["oss-repo-management.dashboard.updated", "oss-repo-management.agent.updated"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
    blockLaunchWhen: ["degraded", "unreachable"],
  },
  catalog: {
    categories: ["oss", "github", "repo-management"],
    capabilities: ["github-issues", "pull-request-context", "embedded-agent", "action-cards", "structured-output"],
  },
};
