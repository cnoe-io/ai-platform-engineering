// assisted-by Codex Codex-sonnet-4-6

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: jest.fn(),
}));

import { deriveRbacSelfCheckReport, repairableMissingTuples, type RbacSelfCheckInventoryInput } from "../self-check";

function baseInput(overrides: Partial<RbacSelfCheckInventoryInput> = {}): RbacSelfCheckInventoryInput {
  return {
    actualTuples: [],
    teams: [{ slug: "platform", name: "Platform" }],
    teamMembershipSources: [],
    dynamicAgents: [],
    mcpServers: [],
    llmModels: [],
    serviceAccounts: [],
    slackChannelGrants: [],
    slackChannelTeamMappings: [],
    webexSpaceGrants: [],
    webexSpaceTeamMappings: [],
    credentialSecretRefs: [],
    users: [],
    sharingAccess: [],
    conversations: [],
    skills: [],
    tasks: [],
    mcpToolCatalog: [],
    generatedAt: "2026-06-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveRbacSelfCheckReport", () => {
  it("flags missing active team membership tuples as repairable", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      teamMembershipSources: [
        { team_slug: "platform", user_subject: "user-1", relationship: "member" },
      ],
    }));

    expect(report.status).toBe("fail");
    expect(report.summary.missing_tuples).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "missing",
          source: "team_membership_sources",
          repairable: true,
          tuple: {
            user: "user:user-1",
            relation: "member",
            object: "team:platform",
          },
        }),
      ]),
    );
    expect(repairableMissingTuples(report)).toEqual([
      { user: "user:user-1", relation: "member", object: "team:platform" },
    ]);
  });

  it("treats admin membership sources as owning inherited member tuples", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      teamMembershipSources: [
        { team_slug: "platform", user_subject: "admin-1", relationship: "admin" },
      ],
      actualTuples: [
        { user: "user:admin-1", relation: "admin", object: "team:platform" },
        { user: "user:admin-1", relation: "member", object: "team:platform" },
      ],
    }));

    expect(report.summary.missing_tuples).toBe(0);
    expect(report.summary.orphan_candidates).toBe(0);
  });

  it("classifies service account scopes that point at deleted agents as stale references", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      serviceAccounts: [
        {
          sa_sub: "sa-1",
          name: "CI bot",
          owning_team_id: "platform",
          scopes_snapshot: [{ type: "agent", ref: "deleted-agent" }],
        },
      ],
      actualTuples: [
        { user: "team:platform#member", relation: "owner_team", object: "service_account:sa-1" },
        { user: "service_account:sa-1", relation: "caller", object: "mcp_gateway:list" },
      ],
    }));

    expect(report.summary.missing_tuples).toBe(0);
    expect(report.summary.stale_references).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "stale_reference",
          source: "service_accounts.scopes_snapshot",
          repairable: false,
          resource: { type: "agent", id: "deleted-agent" },
        }),
      ]),
    );
    expect(repairableMissingTuples(report)).toEqual([]);
  });

  it("does not classify current active-user login baseline tuples as orphan candidates", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      users: [
        {
          email: "sri@example.com",
          name: "Sri",
          keycloak_sub: "sri-sub",
          metadata: { role: "admin" },
        },
      ],
      actualTuples: [
        { user: "user:sri-sub", relation: "member", object: "organization:caipe" },
        { user: "user:sri-sub", relation: "caller", object: "mcp_gateway:list" },
        { user: "user:sri-sub", relation: "admin", object: "organization:caipe" },
        { user: "user:sri-sub", relation: "manager", object: "mcp_server:agentgateway" },
      ],
    }));

    expect(report.expected_by_source.baseline_access).toBe(4);
    expect(report.summary.orphan_candidates).toBe(0);
    expect(report.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          tuple: expect.objectContaining({ user: "user:sri-sub" }),
        }),
      ]),
    );
  });

  it("still reviews explicit admin baseline grants for users that are known non-admins", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      users: [
        {
          email: "member@example.com",
          keycloak_sub: "member-sub",
          metadata: { role: "user" },
        },
      ],
      actualTuples: [
        { user: "user:member-sub", relation: "admin", object: "organization:caipe" },
      ],
    }));

    expect(report.summary.orphan_candidates).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          tuple: { user: "user:member-sub", relation: "admin", object: "organization:caipe" },
        }),
      ]),
    );
  });

  it("does not classify the configured default agent grant as an orphan", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      platformConfig: { default_agent_id: "agent-sre-agent" },
      dynamicAgents: [
        {
          _id: "agent-sre-agent",
          name: "SRE Agent",
          visibility: "team",
          owner_subject: "owner-sub",
        },
      ],
      actualTuples: [
        { user: "user:owner-sub", relation: "owner", object: "agent:agent-sre-agent" },
        { user: "organization:caipe#admin", relation: "manager", object: "agent:agent-sre-agent" },
        { user: "user:*", relation: "user", object: "agent:agent-sre-agent" },
      ],
    }));

    expect(report.expected_by_source["platform_config.default_agent_id"]).toBe(1);
    expect(report.summary.orphan_candidates).toBe(0);
  });

  it("does not classify platform AgentGateway admin grants as orphan candidates", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      actualTuples: [
        { user: "organization:caipe#admin", relation: "manager", object: "mcp_server:agentgateway" },
      ],
    }));

    expect(report.expected_by_source.baseline_access).toBe(1);
    expect(report.summary.orphan_candidates).toBe(0);
  });

  it("does not classify system-owned bootstrap agents as orphan candidates", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      dynamicAgents: [
        {
          _id: "hello-world",
          name: "Hello World",
          owner_id: "system",
          visibility: "global",
        },
      ],
      actualTuples: [
        { user: "user:system", relation: "owner", object: "agent:hello-world" },
        { user: "organization:caipe#admin", relation: "manager", object: "agent:hello-world" },
        { user: "user:*", relation: "user", object: "agent:hello-world" },
      ],
    }));

    expect(report.expected_by_source["dynamic_agents.system_owner"]).toBe(1);
    expect(report.summary.orphan_candidates).toBe(0);
  });

  it("labels legacy organization-wide grants on user-created MCP servers", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      mcpServers: [
        {
          _id: "mcp-github",
          name: "Github",
          config_driven: false,
          owner_subject: "owner-sub",
        },
      ],
      actualTuples: [
        { user: "user:owner-sub", relation: "owner", object: "mcp_server:mcp-github" },
        { user: "organization:caipe#admin", relation: "manager", object: "mcp_server:mcp-github" },
        { user: "organization:caipe#member", relation: "reader", object: "mcp_server:mcp-github" },
      ],
    }));

    expect(report.summary.orphan_candidates).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          title: "Legacy organization-wide MCP grant",
          tuple: {
            user: "organization:caipe#member",
            relation: "reader",
            object: "mcp_server:mcp-github",
          },
          review_action: expect.objectContaining({ type: "revoke_tuple" }),
        }),
      ]),
    );
  });

  it("checks agent runtime tool grants when the tool exists in the catalog", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      dynamicAgents: [
        {
          _id: "agent-sre",
          name: "SRE",
          owner_subject: "owner-1",
          owner_team_slug: "platform",
          visibility: "team",
          allowed_tools: { github: true },
        },
      ],
      mcpToolCatalog: [{ server_id: "github", tool_id: "__catalog_marker__" }],
      actualTuples: [
        { user: "user:owner-1", relation: "owner", object: "agent:agent-sre" },
        { user: "organization:caipe#admin", relation: "manager", object: "agent:agent-sre" },
        { user: "team:platform#member", relation: "user", object: "agent:agent-sre" },
        { user: "team:platform#admin", relation: "manager", object: "agent:agent-sre" },
      ],
    }));

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "missing",
          source: "dynamic_agents.allowed_tools",
          tuple: {
            user: "agent:agent-sre",
            relation: "caller",
            object: "tool:github/*",
          },
        }),
      ]),
    );
  });

  it("labels orphaned LLM model tuples as stale when the model is no longer configured", () => {
    const staleModelId = "global.anthropic.claude-sonnet-4-20250522-v1:0";
    const encodedModelId = Buffer.from(staleModelId, "utf8").toString("base64url");
    const report = deriveRbacSelfCheckReport(baseInput({
      llmModels: [
        {
          _id: "global.anthropic.claude-sonnet-4-6",
          model_id: "global.anthropic.claude-sonnet-4-6",
          config_driven: true,
        },
      ],
      actualTuples: [
        {
          user: "organization:caipe#member",
          relation: "reader",
          object: `llm_model:b64_${encodedModelId}`,
        },
        {
          user: "organization:caipe#member",
          relation: "reader",
          object: "llm_model:global.anthropic.claude-sonnet-4-6",
        },
        {
          user: "organization:caipe#admin",
          relation: "manager",
          object: "llm_model:global.anthropic.claude-sonnet-4-6",
        },
      ],
    }));

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          title: "Stale LLM model access tuple",
          detail: expect.stringContaining(staleModelId),
          review_action: expect.objectContaining({ type: "revoke_tuple" }),
          resource: { type: "llm_model", id: staleModelId },
        }),
      ]),
    );
  });

  it("labels old Slack channel team grants as stale when the channel mapping changed", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      teams: [
        { slug: "old-team", name: "Old Team" },
        { slug: "current-team", name: "Current Team" },
      ],
      slackChannelTeamMappings: [
        {
          slack_workspace_id: "CAIPE",
          slack_channel_id: "C123",
          team_slug: "current-team",
        },
      ],
      actualTuples: [
        { user: "team:current-team#admin", relation: "manager", object: "slack_channel:CAIPE--C123" },
        { user: "team:current-team#member", relation: "user", object: "slack_channel:CAIPE--C123" },
        { user: "team:current-team#member", relation: "manager", object: "slack_channel:CAIPE--C123" },
        { user: "team:old-team#member", relation: "user", object: "slack_channel:CAIPE--C123" },
      ],
    }));

    expect(report.summary.missing_tuples).toBe(0);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          title: "Stale Slack channel team grant",
          detail: expect.stringContaining("Current mapped team: current-team"),
          review_action: expect.objectContaining({ type: "revoke_tuple" }),
          resource: { type: "slack_channel", id: "CAIPE--C123" },
        }),
      ]),
    );
  });

  it("labels legacy team grants on global agents as redundant", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      teams: [{ slug: "legacy-team", name: "Legacy Team" }],
      dynamicAgents: [
        {
          _id: "hello-world",
          name: "Hello World",
          visibility: "global",
        },
      ],
      actualTuples: [
        { user: "organization:caipe#admin", relation: "manager", object: "agent:hello-world" },
        { user: "user:*", relation: "user", object: "agent:hello-world" },
        { user: "team:legacy-team#member", relation: "user", object: "agent:hello-world" },
      ],
    }));

    expect(report.summary.missing_tuples).toBe(0);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          title: "Redundant global-agent team grant",
          detail: expect.stringContaining("Hello World is global"),
          fix: expect.stringContaining("The global agent grant remains in place"),
          review_action: expect.objectContaining({ type: "revoke_tuple" }),
          resource: { type: "agent", id: "hello-world", label: "Hello World" },
        }),
      ]),
    );
  });

  it("labels old agent team grants as stale when current owner and shared teams changed", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      teams: [
        { slug: "old-team", name: "Old Team" },
        { slug: "current-team", name: "Current Team" },
      ],
      dynamicAgents: [
        {
          _id: "agent-private-project-agent",
          name: "Private Project Agent",
          visibility: "team",
          owner_team_slug: "current-team",
        },
      ],
      actualTuples: [
        { user: "organization:caipe#admin", relation: "manager", object: "agent:agent-private-project-agent" },
        { user: "team:current-team#member", relation: "user", object: "agent:agent-private-project-agent" },
        { user: "team:current-team#admin", relation: "manager", object: "agent:agent-private-project-agent" },
        { user: "team:old-team#member", relation: "user", object: "agent:agent-private-project-agent" },
      ],
    }));

    expect(report.summary.missing_tuples).toBe(0);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          title: "Stale agent team grant",
          detail: expect.stringContaining("Current agent team: current-team"),
          fix: expect.stringContaining("add this team back to the agent owner/share settings"),
          review_action: expect.objectContaining({ type: "revoke_tuple" }),
          resource: { type: "agent", id: "agent-private-project-agent", label: "Private Project Agent" },
        }),
      ]),
    );
  });

  it("labels membership tuples for deleted teams as stale deleted-team memberships", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      actualTuples: [
        {
          user: "user:33607742-8cb9-4dd3-8579-166a7ac65723",
          relation: "member",
          object: "team:rbac-kb-one-1781710604916-uitbka",
        },
      ],
    }));

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "orphan_candidate",
          title: "Stale deleted-team membership tuple",
          detail: expect.stringContaining("generated RBAC test team"),
          fix: expect.stringContaining("remove the dangling team membership"),
          review_action: expect.objectContaining({ type: "revoke_tuple" }),
          resource: { type: "team", id: "rbac-kb-one-1781710604916-uitbka" },
        }),
      ]),
    );
  });

  it("counts every orphan candidate even when only the first page is displayed", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      actualTuples: Array.from({ length: 80 }, (_, index) => ({
        user: "user:33607742-8cb9-4dd3-8579-166a7ac65723",
        relation: "member",
        object: `team:rbac-e2e-${index}`,
      })),
    }));

    expect(report.summary.orphan_candidates).toBe(80);
    expect(report.findings.filter((finding) => finding.severity === "orphan_candidate")).toHaveLength(75);
    expect(report.notes).toEqual(
      expect.arrayContaining([
        "Showing the first 75 of 80 unowned tuples. Re-run after cleanup to reveal the next batch.",
      ]),
    );
  });

  it("runs only the selected source checks", () => {
    const report = deriveRbacSelfCheckReport(
      baseInput({
        teamMembershipSources: [
          { team_slug: "platform", user_subject: "user-1", relationship: "member" },
        ],
        dynamicAgents: [
          {
            _id: "agent-sre",
            name: "SRE",
            allowed_tools: { github: true },
          },
        ],
        mcpToolCatalog: [{ server_id: "github", tool_id: "__catalog_marker__" }],
      }),
      { checks: ["team_memberships"] },
    );

    expect(report.scope).toEqual({
      selected: ["team_memberships"],
      labels: ["Teams"],
      all: false,
    });
    expect(report.summary.missing_tuples).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "team_membership_sources" }),
      ]),
    );
    expect(report.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "dynamic_agents.allowed_tools" }),
      ]),
    );
  });

  it("does not classify expected tuples from unselected checks as scoped orphans", () => {
    const report = deriveRbacSelfCheckReport(
      baseInput({
        serviceAccounts: [
          {
            sa_sub: "sa-1",
            name: "CI bot",
            scopes_snapshot: [{ type: "tool", ref: "github/*" }],
          },
        ],
        mcpToolCatalog: [{ server_id: "github", tool_id: "__catalog_marker__" }],
        actualTuples: [
          { user: "service_account:sa-1", relation: "caller", object: "mcp_gateway:list" },
          { user: "service_account:sa-1", relation: "caller", object: "tool:github/*" },
        ],
      }),
      { checks: ["agent_tools"] },
    );

    expect(report.scope?.selected).toEqual(["agent_tools"]);
    expect(report.summary.expected_tuples).toBe(0);
    expect(report.summary.orphan_candidates).toBe(0);
    expect(report.status).toBe("pass");
  });

  it("passes when every expected tuple is present", () => {
    const report = deriveRbacSelfCheckReport(baseInput({
      teamMembershipSources: [
        { team_slug: "platform", user_subject: "user-1", relationship: "member" },
      ],
      actualTuples: [
        { user: "user:user-1", relation: "member", object: "team:platform" },
      ],
    }));

    expect(report.summary.missing_tuples).toBe(0);
    expect(report.status).toBe("pass");
  });
});
