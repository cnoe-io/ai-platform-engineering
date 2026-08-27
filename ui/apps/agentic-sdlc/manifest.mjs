// assisted-by Codex Codex-sonnet-4-6

export const AGENTIC_SDLC_APP_ID = "agentic-sdlc";

export const AGENTIC_SDLC_MANIFEST = {
  id: AGENTIC_SDLC_APP_ID,
  displayName: "Agentic SDLC",
  description:
    "Spec-driven development, ship loop coordination, and SDLC workflows integrated with CAIPE agents.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/agentic-sdlc",
  },
  ui: {
    contractVersion: "1.0",
    surface: "standalone",
    routes: ["/", "/:owner/:repo", "/:owner/:repo/epics/:epicId"],
  },
  authorization: { resourceType: "agentic_app", launchAction: "use" },
  surfaces: {
    showInHub: true,
    showInTopNav: true,
    navOrder: 5,
    homeEligible: true,
    overlays: ["chat"],
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["agents:invoke", "sdlc:read"],
    policyActions: [
      {
        action: "proxy:GET",
        description: "Read Agentic SDLC pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["sdlc:read"],
      },
      {
        action: "proxy:HEAD",
        description: "Probe Agentic SDLC pages through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["sdlc:read"],
      },
      {
        action: "proxy:POST",
        description: "Run Agentic SDLC actions through the app gateway",
        defaultEffect: "allow",
        requiredScopes: ["agents:invoke"],
      },
      {
        action: "webhook.github.repo-events",
        description: "Forward GitHub webhook events to Agentic SDLC",
        defaultEffect: "allow",
        requiredScopes: ["sdlc:read"],
      },
    ],
  },
  assistant: {
    enabled: true,
    agentId: "agent-agentic-sdlc",
    schemaVersions: ["1.0"],
    maxContextBytes: 8192,
    capability: "sdlc-assistant",
    suggestions: true,
    label: "Ask Agentic SDLC",
    agentName: "Agentic SDLC Assistant",
  },
  agents: [
    {
      id: "agentic-sdlc-agent",
      displayName: "Agentic SDLC Agent",
      required: true,
      dynamicAgentId: "agent-agentic-sdlc",
      capabilities: ["spec-driven-development", "ship-loop", "repository-delivery"],
    },
  ],
  data: {
    apiBasePath: "/api/agentic-sdlc",
    eventChannels: ["sdlc.repo.updated", "sdlc.ship_loop.updated"],
  },
  webhooks: [
    {
      provider: "github",
      channel: "repo-events",
      upstreamPath: "/webhooks/github",
      allowedMethods: ["POST"],
      verificationOwner: "app",
      preservedHeaders: ["x-github-event", "x-github-delivery", "x-hub-signature-256"],
      maxBodyBytes: 131072,
      policyAction: "webhook.github.repo-events",
    },
  ],
  health: {
    endpoint: "/healthz",
    timeoutMs: 2000,
    blockLaunchWhen: ["degraded", "unreachable"],
  },
  catalog: {
    categories: ["sdlc", "platform"],
    capabilities: ["spec", "ship-loop"],
    compatibility: "^1.0.0",
  },
};
