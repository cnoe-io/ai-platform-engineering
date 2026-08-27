// assisted-by Codex Codex-sonnet-4-6

export const OSS_REPO_MANAGEMENT_APP_ID = "oss-repo-management";

export const OSS_REPO_MANAGEMENT_MANIFEST = {
  id: OSS_REPO_MANAGEMENT_APP_ID,
  displayName: "OSS Repo Report Card",
  description:
    "A source-backed OSS report card with activity and contributor trends, OpenSSF and GitHub security signals, foundation-readiness criteria, timestamped reports, CAS-protected credentials, and CAIPE context sharing.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/oss-repo-management",
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
          key: "staleDays",
          label: "Stale issue threshold (days)",
          type: "number",
          default: 30,
          min: 1,
          max: 365,
        },
      ],
    },
  },
  authorization: { resourceType: "agentic_app", launchAction: "use" },
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
        action: "proxy:GET",
        description: "Read OSS repository pages and data through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["oss-repo-management:read"],
      },
      {
        action: "proxy:HEAD",
        description: "Probe OSS repository pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["oss-repo-management:read"],
      },
      {
        action: "proxy:POST",
        description: "Run embedded GitHub repository agent",
        defaultEffect: "allow",
        requiredScopes: ["oss-repo-management:agent:invoke"],
      },
      {
        action: "agent.invoke.github",
        description: "Invoke the configured GitHub repository agent",
        defaultEffect: "allow",
        requiredScopes: ["oss-repo-management:agent:invoke", "agents:invoke"],
      },
    ],
  },
  assistant: {
    enabled: true,
    agentId: "agent-oss-repo-report-card",
    schemaVersions: ["1.0"],
    maxContextBytes: 12288,
    capability: "contextual-chat",
    suggestions: true,
    label: "Ask Report Card",
    agentName: "Repo Report Card Assistant",
  },
  agents: [
    {
      id: "github-agent",
      displayName: "OSS Repo Report Card Agent",
      required: true,
      dynamicAgentId: "agent-oss-repo-report-card",
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
    categories: ["oss", "github", "report-card"],
    capabilities: ["github-rest-api", "activity-trends", "contributor-health", "security-posture", "openssf-scorecard", "foundation-readiness", "timestamped-reports", "optional-agent", "structured-output"],
  },
};
