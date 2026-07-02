import {
  ambiguousRoutesMessage,
  formatAgentLabel,
  missingRouteMetadataMessage,
  staleRouteMetadataMessage,
} from "@/lib/rbac/connector-diagnostic-messages";
import {
  planSlackRouteFixes,
  slackRouteFixesNeeded,
} from "@/lib/rbac/slack-channel-route-fix";
import type { ConnectorRuntimeRouteDiagnostic } from "@/lib/rbac/connector-diagnostics";
import type { ItemAgentRoute } from "@/components/admin/rebac/connector-admin-adapter";

describe("connector-diagnostic-messages", () => {
  it("formats agent slugs for admin copy", () => {
    expect(formatAgentLabel("agent-meraki-file-upload")).toBe("Meraki File Upload");
    expect(formatAgentLabel("agent-jira-gu")).toBe("Jira Gu");
  });

  it("uses plain language for missing route metadata", () => {
    expect(missingRouteMetadataMessage("agent-meraki-file-upload")).toContain("Meraki File Upload");
    expect(missingRouteMetadataMessage("agent-meraki-file-upload")).toContain("@mentions");
  });

  it("uses plain language for stale route metadata", () => {
    expect(staleRouteMetadataMessage("agent-jira-gu")).toContain("Jira Gu");
    expect(staleRouteMetadataMessage("agent-jira-gu")).toContain("inactive");
  });

  it("explains ambiguous routes without OpenFGA jargon", () => {
    const message = ambiguousRoutesMessage(
      ["agent-jira-gu", "agent-meraki-file-upload"],
      "mention",
      100,
      "agent-jira-gu",
    );
    expect(message).toContain("Jira Gu");
    expect(message).toContain("Meraki File Upload");
    expect(message).toContain("Fix routing issues");
    expect(message).not.toContain("OpenFGA");
  });
});

describe("slack-channel-route-fix", () => {
  const diagnosticsRoutes: ConnectorRuntimeRouteDiagnostic[] = [
    {
      agent_id: "agent-jira-gu",
      openfga_tuple: true,
      route_metadata: true,
      listen: "all",
      priority: 100,
      runtime_matches: { mention: true, message: true },
      warnings: [],
    },
    {
      agent_id: "agent-meraki-file-upload",
      openfga_tuple: true,
      route_metadata: false,
      listen: "mention",
      priority: 100,
      runtime_matches: { mention: true, message: false },
      warnings: [],
    },
  ];

  it("detects when automatic fixes are needed", () => {
    const existingRoutes: ItemAgentRoute[] = [
      {
        agent_id: "agent-jira-gu",
        enabled: true,
        priority: 100,
        users: { enabled: true, listen: "all" },
      },
    ];
    expect(slackRouteFixesNeeded(diagnosticsRoutes, existingRoutes)).toBe(true);
  });

  it("saves missing metadata and separates mention priorities", () => {
    const existingRoutes: ItemAgentRoute[] = [
      {
        agent_id: "agent-jira-gu",
        enabled: true,
        priority: 100,
        users: { enabled: true, listen: "all" },
      },
    ];
    const planned = planSlackRouteFixes(
      diagnosticsRoutes,
      existingRoutes,
      "agent-jira-gu",
    );
    const meraki = planned.find((route) => route.agent_id === "agent-meraki-file-upload");
    const jira = planned.find((route) => route.agent_id === "agent-jira-gu");
    expect(meraki?.users?.listen).toBe("mention");
    expect(jira?.priority).toBe(100);
    expect(meraki?.priority).toBeGreaterThan(jira?.priority ?? 0);
  });
});
