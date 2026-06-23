export interface PlatformHealthRemediationLink {
  label: string;
  href: string;
  description: string;
}

/** Where operators land when AgentGateway probes fail in Platform Health. */
export const AGENTGATEWAY_HEALTH_REMEDIATION: PlatformHealthRemediationLink = {
  label: "MCP Servers",
  href: "/dynamic-agents?tab=mcp-servers",
  description:
    "Open MCP Servers to sync AgentGateway routes, verify tool authorization, and run Repair AgentGateway if registrations are stale.",
};

export const PROMETHEUS_UNAVAILABLE_MESSAGE =
  "Throughput and sub-agent charts are optional. Dependency checks above still report platform health without Prometheus.";

export const PROMETHEUS_SETUP_GUIDANCE = {
  title: "Optional: enable live agent metrics",
  body: "Ask your platform admin to set PROMETHEUS_URL on the UI service (for example http://prometheus:9090), then restart caipe-ui. Until then, use the dependency checks above.",
};
