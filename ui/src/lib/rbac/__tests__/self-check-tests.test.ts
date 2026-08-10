/**
 * @jest-environment node
 */

// assisted-by Codex Codex-sonnet-4-6

const mockAuthorize = jest.fn();
const mockGetCollection = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockRunRbacSelfCheck = jest.fn();
const mockGetUnlinkedServiceAccount = jest.fn();

jest.mock("@/lib/authz", () => ({
  authorize: (...args: unknown[]) => mockAuthorize(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/self-check", () => ({
  runRbacSelfCheck: (...args: unknown[]) => mockRunRbacSelfCheck(...args),
}));

jest.mock("@/lib/rbac/unlinked-service-account", () => ({
  getUnlinkedServiceAccount: (...args: unknown[]) => mockGetUnlinkedServiceAccount(...args),
}));

const rowsByCollection: Record<string, unknown[]> = {
  teams: [{ slug: "platform", status: "active" }],
  team_membership_sources: [{ team_slug: "platform", user_subject: "member-sub", relationship: "member", status: "active" }],
  dynamic_agents: [
    {
      _id: "agent-sre",
      name: "SRE Agent",
      visibility: "global",
      allowed_tools: { mcp1: ["search"] },
    },
  ],
  mcp_servers: [{ _id: "mcp1", name: "MCP One", config_driven: true }],
  llm_models: [{ model_id: "gpt-test", config_driven: true }],
  credential_secret_refs: [
    { id: "secret-private", name: "Private", owner: { type: "user", id: "owner-sub" }, sharedWithTeams: [] },
    { id: "secret-shared", name: "Shared", owner: { type: "user", id: "owner-sub" }, sharedWithTeams: ["platform"] },
  ],
  service_accounts: [
    {
      sa_sub: "sa-linked",
      name: "Linked SA",
      status: "active",
      scopes_snapshot: [
        { type: "agent", ref: "agent-sre" },
        { type: "tool", ref: "mcp1/search" },
      ],
    },
    { sa_sub: "sa-unlinked", name: "Unlinked SA", status: "active", is_platform_unlinked: true },
  ],
  slack_channel_grants: [],
  channel_team_mappings: [{ slack_workspace_id: "CAIPE", slack_channel_id: "C123", team_slug: "platform" }],
  webex_space_grants: [],
  webex_space_team_mappings: [{ webex_workspace_id: "Cisco", webex_space_id: "S123", team_slug: "platform" }],
  agent_skills: [{ id: "skill-1", name: "Skill One" }],
  task_configs: [{ id: "task-1", name: "Task One" }],
  mcp_tool_catalog: [{ server_id: "mcp1", tool_id: "search" }],
};

function collectionFor(name: string) {
  return {
    find: jest.fn(() => ({
      toArray: jest.fn(async () => rowsByCollection[name] ?? []),
    })),
  };
}

function selfCheckReport() {
  return {
    generated_at: "2026-06-28T00:00:00.000Z",
    status: "pass",
    inventory: { mongo: {}, openfga_tuple_count: 0, openfga_tuples_by_object_type: {}, organization_capability_tuples: [] },
    summary: {
      expected_tuples: 12,
      missing_tuples: 0,
      stale_references: 0,
      orphan_candidates: 0,
      repairable_findings: 0,
      total_findings: 0,
    },
    expected_by_source: {
      team_membership_sources: 1,
      "dynamic_agents.owner/shared teams": 1,
      "dynamic_agents.allowed_tools": 1,
      mcp_servers: 1,
      llm_models: 1,
      service_accounts: 1,
      "credential_secret_refs.owner": 1,
      "credential_secret_refs.sharedWithTeams": 1,
      channel_team_mappings: 1,
      webex_space_team_mappings: 1,
    },
    missing_by_source: {},
    findings: [],
    repair_batches: [],
    notes: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCollection.mockImplementation((name: string) => collectionFor(name));
  mockReadOpenFgaTuples.mockResolvedValue({
    tuples: [
      { key: { user: "team:platform#member", relation: "reader", object: "knowledge_base:kb-1" } },
      { key: { user: "knowledge_base:kb-1", relation: "parent_kb", object: "data_source:kb-1" } },
      { key: { user: "team:platform#member", relation: "user", object: "skill:skill-1" } },
      { key: { user: "team:platform#member", relation: "user", object: "task:task-1" } },
    ],
    continuationToken: undefined,
  });
  mockRunRbacSelfCheck.mockResolvedValue(selfCheckReport());
  mockGetUnlinkedServiceAccount.mockResolvedValue(null);
  mockAuthorize.mockImplementation(async (request) => {
    if (request.subject.id === "sa-unlinked") {
      return request.resource.type === "mcp_gateway"
        ? { decision: "ALLOW", reason: "OK", retriable: false }
        : { decision: "DENY", reason: "NO_CAPABILITY", retriable: false };
    }
    if (request.subject.id === "member-sub" && request.resource.id === "secret-private") {
      return { decision: "DENY", reason: "NO_CAPABILITY", retriable: false };
    }
    return { decision: "ALLOW", reason: "OK", retriable: false };
  });
});

it("runs the built-in RBAC matrix against inventory and actor slots", async () => {
  const { runRbacSelfCheckTests } = await import("../self-check-tests");

  const report = await runRbacSelfCheckTests({
    callerSubject: { type: "user", id: "admin-sub" },
  });

  expect(report.status).toBe("pass");
  expect(report.actors.map((actor) => actor.key)).toEqual([
    "org_admin",
    "member_user",
    "service_account",
    "unlinked_service_account",
  ]);
  expect(report.summary.failed).toBe(0);
  expect(report.suites.find((suite) => suite.id === "credentials")?.status).toBe("pass");
  expect(report.suites.find((suite) => suite.id === "service_accounts")?.status).toBe("pass");
  expect(mockRunRbacSelfCheck).toHaveBeenCalledWith({
    checks: expect.arrayContaining(["team_memberships", "agent_access", "credentials"]),
  });
});

it("supports caller-supplied CI assertions", async () => {
  const { runRbacSelfCheckTests } = await import("../self-check-tests");

  const report = await runRbacSelfCheckTests({
    suites: ["credentials"],
    assertions: [
      {
        id: "private-credential-denied",
        actor: { type: "user", id: "member-sub", label: "Member" },
        resource: { type: "secret_ref", id: "secret-private" },
        action: "read-metadata",
        expect: "DENY",
      },
    ],
  });

  const custom = report.suites.find((suite) => suite.id === "custom_assertions");
  expect(custom?.status).toBe("pass");
  expect(custom?.cases[0].checks[0]).toMatchObject({
    expected: "DENY",
    actual: "DENY",
    status: "pass",
  });
});
