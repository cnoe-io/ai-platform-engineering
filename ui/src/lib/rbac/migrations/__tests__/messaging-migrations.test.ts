jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/rbac/openfga", () => ({ writeOpenFgaTuples: jest.fn() }));

import {
  deriveMessagingIndexPlan,
  deriveMessagingRebacPlan,
  deriveMessagingTeamMappingPlan,
} from "../registry";

describe("messaging RBAC migration derivation", () => {
  it("deduplicates Slack grant and route tuples and records provenance relationships", () => {
    const plan = deriveMessagingRebacPlan({
      surface: {
        migrationId: "slack_channel_rebac_backfill_v1",
        schemaArea: "slack_channel_rebac",
        confirmation: "MIGRATE slack_channel_rebac TO v2",
        subjectType: "slack_channel",
        idField: "channel_id",
        routeIdField: "channel_id",
      },
      grants: [
        {
          workspace_id: "T123",
          channel_id: "C123",
          resource: { type: "agent", id: "agent-1" },
          actions: ["use"],
          status: "active",
        },
      ],
      routes: [
        { workspace_id: "T123", channel_id: "C123", agent_id: "agent-1", status: "active" },
      ],
    });

    expect(plan.tuples).toEqual([
      { user: "slack_channel:T123--C123", relation: "user", object: "agent:agent-1" },
    ]);
    expect(plan.counts).toMatchObject({
      grants_scanned: 1,
      routes_scanned: 1,
      tuples_planned: 1,
      relationships_planned: 2,
    });
    expect(plan.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: { type: "slack_channel", id: "T123--C123" },
          action: "use",
          resource: { type: "agent", id: "agent-1" },
        }),
      ]),
    );
  });

  it("skips invalid Webex identifiers and unsupported actions", () => {
    const plan = deriveMessagingRebacPlan({
      surface: {
        migrationId: "webex_space_rebac_backfill_v1",
        schemaArea: "webex_space_rebac",
        confirmation: "MIGRATE webex_space_rebac TO v2",
        subjectType: "webex_space",
        idField: "space_id",
        routeIdField: "space_id",
      },
      grants: [
        {
          workspace_id: "WEBEX",
          space_id: "space-1",
          resource: { type: "knowledge_base", id: "kb-1" },
          actions: ["read", "unsupported"],
          status: "active",
        },
        {
          workspace_id: "WEBEX",
          space_id: "bad id",
          resource: { type: "agent", id: "agent-1" },
          actions: ["use"],
          status: "active",
        },
      ],
      routes: [{ workspace_id: "WEBEX", space_id: "space-2", agent_id: "", status: "active" }],
    });

    expect(plan.tuples).toEqual([
      { user: "webex_space:WEBEX--space-1", relation: "reader", object: "knowledge_base:kb-1" },
    ]);
    expect(plan.counts).toMatchObject({
      invalid_identifiers: 2,
      unsupported_actions: 1,
      tuples_planned: 1,
    });
  });

  it("returns an empty plan for empty messaging inputs", () => {
    const plan = deriveMessagingRebacPlan({
      surface: {
        migrationId: "slack_channel_rebac_backfill_v1",
        schemaArea: "slack_channel_rebac",
        confirmation: "MIGRATE slack_channel_rebac TO v2",
        subjectType: "slack_channel",
        idField: "channel_id",
        routeIdField: "channel_id",
      },
      grants: [],
      routes: [],
    });

    expect(plan.tuples).toEqual([]);
    expect(plan.counts).toMatchObject({
      grants_scanned: 0,
      routes_scanned: 0,
      tuples_planned: 0,
      relationships_planned: 0,
    });
  });

  it("plans Slack and Webex team mapping repairs", () => {
    const plan = deriveMessagingTeamMappingPlan({
      teams: [{ _id: "team-1", slug: "platform" }],
      slackMappings: [
        {
          slack_workspace_id: "T123",
          slack_channel_id: "C123",
          channel_name: "incidents",
          team_slug: "platform",
          status: "active",
        },
      ],
      webexMappings: [
        {
          workspace_id: "WEBEX",
          space_id: "space-1",
          space_name: "War Room",
          team_id: "team-1",
          status: "active",
        },
      ],
    });

    expect(plan.teamMappingRepairs).toEqual([
      {
        team_id: "team-1",
        slack_channel: {
          slack_channel_id: "C123",
          channel_name: "incidents",
          slack_workspace_id: "T123",
        },
      },
      {
        team_id: "team-1",
        webex_space: {
          space_id: "space-1",
          space_name: "War Room",
          workspace_id: "WEBEX",
        },
      },
    ]);
  });

  it("plans Webex messaging indexes", () => {
    const plan = deriveMessagingIndexPlan();

    expect(plan.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: "webex_space_team_mappings" }),
        expect.objectContaining({ collection: "webex_space_agent_routes" }),
        expect.objectContaining({ collection: "webex_space_grants" }),
        expect.objectContaining({ collection: "webex_link_nonces" }),
      ]),
    );
  });
});
