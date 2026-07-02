const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveMigrationPlan,
  hasAgentUserTypedWildcard,
  runBackfill,
  resolveDefaultAgent,
} = require("../backfill-universal-rebac.ts");

type BackfillCollections = import("../backfill-universal-rebac").BackfillCollections;
type OpenFgaTupleKey = import("../backfill-universal-rebac").OpenFgaTupleKey;

const NOW = "2026-05-16T00:00:00.000Z";

function tupleKey(tuple: OpenFgaTupleKey): string {
  return `${tuple.user} ${tuple.relation} ${tuple.object}`;
}

test("derives team membership tuples from mapped team members", () => {
  const plan = deriveMigrationPlan({
    now: NOW,
    teams: [
      {
        _id: "team-1",
        slug: "platform",
        members: [
          { user_id: "alice@example.com", role: "member" },
          { user_id: "bob@example.com", role: "owner" },
        ],
      },
    ],
    users: [{ email: "alice@example.com", subject: "alice-sub" }],
    membershipSources: [{ user_email: "bob@example.com", user_subject: "bob-sub" }],
    dynamicAgents: [],
    platformConfig: {},
    envDefaultAgentId: null,
  });

  assert.deepEqual(plan.tuples.map(tupleKey).sort(), [
    "user:alice-sub member team:platform",
    "user:bob-sub admin team:platform",
  ]);
  assert.equal(plan.counts.membershipTuplesPlanned, 2);
});

test("prefers persisted keycloak_sub for team membership subjects", () => {
  const plan = deriveMigrationPlan({
    now: NOW,
    teams: [
      {
        _id: "team-1",
        slug: "platform",
        members: [{ user_id: "alice@example.com", role: "member" }],
      },
    ],
    users: [{ email: "alice@example.com", keycloak_sub: "alice-keycloak-sub" }],
    membershipSources: [],
    dynamicAgents: [],
    platformConfig: {},
    envDefaultAgentId: null,
  });

  assert.deepEqual(plan.tuples.map(tupleKey), [
    "user:alice-keycloak-sub member team:platform",
  ]);
});

test("prefers user keycloak_sub over legacy membership source subjects", () => {
  const plan = deriveMigrationPlan({
    now: NOW,
    teams: [
      {
        _id: "team-1",
        slug: "platform",
        members: [{ user_id: "alice@example.com", role: "member" }],
      },
    ],
    users: [{ email: "alice@example.com", keycloak_sub: "alice-keycloak-sub" }],
    membershipSources: [{ user_email: "alice@example.com", user_subject: "alice@example.com" }],
    dynamicAgents: [],
    platformConfig: {},
    envDefaultAgentId: null,
  });

  assert.deepEqual(plan.tuples.map(tupleKey), [
    "user:alice-keycloak-sub member team:platform",
  ]);
});

test("derives team resource tuples and provenance records", () => {
  const plan = deriveMigrationPlan({
    now: NOW,
    teams: [
      {
        _id: "team-1",
        slug: "platform",
        members: [],
        resources: {
          agents: ["sre-agent"],
          agent_admins: ["admin-agent"],
          tools: ["jira_*"],
          knowledge_bases: ["prod-kb"],
          skills: ["incident-review"],
          tasks: ["weekly-report"],
        },
      },
    ],
    users: [],
    membershipSources: [],
    dynamicAgents: [],
    platformConfig: {},
    envDefaultAgentId: null,
  });

  assert.deepEqual(plan.tuples.map(tupleKey).sort(), [
    "team:platform#admin manager agent:admin-agent",
    "team:platform#member caller tool:jira_*",
    "team:platform#member reader knowledge_base:prod-kb",
    "team:platform#member user agent:sre-agent",
    "team:platform#member user skill:incident-review",
    "team:platform#member user task:weekly-report",
  ].sort());
  assert.equal(plan.relationships.length, 6);
  assert.equal(plan.relationships[0]?.source_type, "migration");
});

test("reports invalid teams and resource identifiers without emitting tuples", () => {
  const plan = deriveMigrationPlan({
    now: NOW,
    teams: [
      { _id: "no-slug", members: [{ user_id: "alice@example.com", role: "member" }] },
      { _id: "bad-resource", slug: "bad:team", members: [] },
      { _id: "team-1", slug: "platform", members: [], resources: { agents: ["bad:id"] } },
    ],
    users: [{ email: "alice@example.com", subject: "alice-sub" }],
    membershipSources: [],
    dynamicAgents: [],
    platformConfig: {},
    envDefaultAgentId: null,
  });

  assert.equal(plan.tuples.length, 0);
  assert.equal(plan.counts.invalidIdentifiers, 3);
  assert.match(plan.warnings.join("\n"), /missing slug/);
});

test("resolves default agent with persisted config before env fallback", () => {
  assert.deepEqual(
    resolveDefaultAgent({
      platformConfig: { default_agent_id: "db-agent" },
      envDefaultAgentId: "env-agent",
      dynamicAgents: [{ id: "db-agent" }, { id: "env-agent" }],
    }),
    { id: "db-agent", source: "db", status: "resolved" },
  );
});

test("resolves DEFAULT_AGENT_ID without a fallback default", () => {
  assert.deepEqual(
    resolveDefaultAgent({
      platformConfig: {},
      envDefaultAgentId: "env-agent",
      dynamicAgents: [{ id: "env-agent" }],
    }),
    { id: "env-agent", source: "env", status: "resolved" },
  );

  assert.deepEqual(
    resolveDefaultAgent({
      platformConfig: {},
      envDefaultAgentId: "",
      dynamicAgents: [],
    }),
    { id: null, source: "fallback", status: "skipped" },
  );
});

test("does not resolve a configured default agent without a dynamic-agent catalog match", () => {
  assert.deepEqual(
    resolveDefaultAgent({
      platformConfig: { default_agent_id: "missing-agent" },
      envDefaultAgentId: null,
      dynamicAgents: [],
    }),
    { id: "missing-agent", source: "db", status: "invalid" },
  );
});

test("requires typed wildcard support for default-agent grant", () => {
  assert.equal(hasAgentUserTypedWildcard("define user: [user, user:*, team#member]"), true);
  assert.equal(hasAgentUserTypedWildcard("define user: [user, team#member]"), false);
});

test("derives user wildcard user tuple for configured default agent", () => {
  const plan = deriveMigrationPlan({
    now: NOW,
    teams: [],
    users: [],
    membershipSources: [],
    dynamicAgents: [{ id: "default-agent" }],
    platformConfig: { default_agent_id: "default-agent" },
    envDefaultAgentId: null,
  });

  assert.deepEqual(plan.defaultAgent, { id: "default-agent", source: "db", status: "resolved" });
  assert.deepEqual(plan.tuples.map(tupleKey), ["user:* user agent:default-agent"]);
});

test("dry-run does not write OpenFGA tuples or migration records", async () => {
  const writes: OpenFgaTupleKey[][] = [];
  const migrationRecords: Array<Record<string, unknown>> = [];
  const collections = fakeCollections({ migrationRecords });

  const result = await runBackfill({
    apply: false,
    force: false,
    now: NOW,
    modelText: "define user: [user, user:*]",
    collections,
    openFga: { writeTuples: async (tuples: OpenFgaTupleKey[]) => void writes.push(tuples) },
    envDefaultAgentId: null,
  });

  assert.equal(result.status, "planned");
  assert.equal(writes.length, 0);
  assert.equal(migrationRecords.length, 0);
});

test("dry-run warns when a default-agent wildcard cannot be represented by the model", async () => {
  const result = await runBackfill({
    apply: false,
    force: false,
    now: NOW,
    modelText: "define user: [user]",
    collections: fakeCollections({
      dynamicAgents: [{ id: "default-agent" }],
      platformConfig: { default_agent_id: "default-agent" },
    }),
    openFga: { writeTuples: async () => undefined },
    envDefaultAgentId: null,
  });

  assert.match(result.warnings.join("\n"), /does not allow user:\*/);
});

test("completed migration records skip non-forced apply", async () => {
  const writes: OpenFgaTupleKey[][] = [];
  const collections = fakeCollections({
    migrationRecords: [{ _id: "openfga_relationship_backfill_v1", status: "completed" }],
  });

  const result = await runBackfill({
    apply: true,
    force: false,
    now: NOW,
    modelText: "define user: [user, user:*]",
    collections,
    openFga: { writeTuples: async (tuples: OpenFgaTupleKey[]) => void writes.push(tuples) },
    envDefaultAgentId: null,
  });

  assert.equal(result.status, "skipped");
  assert.equal(writes.length, 0);
});

test("forced apply rechecks relationships idempotently", async () => {
  const writes: OpenFgaTupleKey[][] = [];
  const migrationRecords = [{ _id: "openfga_relationship_backfill_v1", status: "completed" }];
  const collections = fakeCollections({
    migrationRecords,
    teams: [{ _id: "team-1", slug: "platform", resources: { agents: ["sre-agent"] } }],
  });

  const result = await runBackfill({
    apply: true,
    force: true,
    now: NOW,
    modelText: "define user: [user, user:*]",
    collections,
    openFga: { writeTuples: async (tuples: OpenFgaTupleKey[]) => void writes.push(tuples) },
    envDefaultAgentId: null,
  });

  assert.equal(result.status, "completed");
  assert.equal(writes.flat().map(tupleKey).join("\n"), "team:platform#member user agent:sre-agent");
});

test("failed apply records failure without completed status", async () => {
  const migrationRecords: Array<Record<string, unknown>> = [];
  const collections = fakeCollections({
    migrationRecords,
    teams: [{ _id: "team-1", slug: "platform", resources: { agents: ["sre-agent"] } }],
  });

  await assert.rejects(
    runBackfill({
      apply: true,
      force: false,
      now: NOW,
      modelText: "define user: [user, user:*]",
      collections,
      openFga: { writeTuples: async () => {
        throw new Error("OpenFGA down");
      } },
      envDefaultAgentId: null,
    }),
    /OpenFGA down/,
  );

  assert.equal(migrationRecords[migrationRecords.length - 1]?.status, "failed");
});

test("migration provenance does not overwrite existing non-migration records", async () => {
  const existingRelationships: Array<Record<string, unknown>> = [
    {
      subject: { type: "team", id: "platform", relation: "member" },
      action: "use",
      resource: { type: "agent", id: "sre-agent" },
      source_type: "manual",
      status: "active",
    },
  ];
  const collections = fakeCollections({
    relationships: existingRelationships,
    teams: [{ _id: "team-1", slug: "platform", resources: { agents: ["sre-agent"] } }],
  });

  await runBackfill({
    apply: true,
    force: false,
    now: NOW,
    modelText: "define user: [user, user:*]",
    collections,
    openFga: { writeTuples: async () => undefined },
    envDefaultAgentId: null,
  });

  assert.equal(existingRelationships[0]?.source_type, "manual");
  assert.equal(existingRelationships.some((row) => row.source_type === "migration"), false);
});

function fakeCollections(seed: {
  teams?: unknown[];
  users?: unknown[];
  membershipSources?: unknown[];
  relationships?: Array<Record<string, unknown>>;
  platformConfig?: Record<string, unknown> | null;
  dynamicAgents?: unknown[];
  migrationRecords?: Array<Record<string, unknown>>;
} = {}): BackfillCollections {
  const relationships = seed.relationships ?? [];
  const membershipSources = seed.membershipSources ?? [];
  const migrationRecords = seed.migrationRecords ?? [];
  return {
    loadTeams: async () => seed.teams ?? [],
    loadUsers: async () => seed.users ?? [],
    loadMembershipSources: async () => membershipSources,
    loadPlatformConfig: async () => seed.platformConfig ?? null,
    loadDynamicAgents: async () => seed.dynamicAgents ?? [],
    getMigrationRecord: async (id) => migrationRecords.find((record) => record._id === id) ?? null,
    saveMigrationRecord: async (record) => {
      const index = migrationRecords.findIndex((existing) => existing._id === record._id);
      if (index >= 0) migrationRecords[index] = record as unknown as Record<string, unknown>;
      else migrationRecords.push(record as unknown as Record<string, unknown>);
    },
    upsertMembershipSources: async (records) => {
      membershipSources.push(...records);
      return records.length;
    },
    upsertRelationships: async (records) => {
      for (const record of records) {
        const existingNonMigration = relationships.find(
          (existing) =>
            JSON.stringify(existing.subject) === JSON.stringify(record.subject) &&
            JSON.stringify(existing.resource) === JSON.stringify(record.resource) &&
            existing.action === record.action &&
            existing.source_type !== "migration",
        );
        if (!existingNonMigration) relationships.push(record as unknown as Record<string, unknown>);
      }
      return records.length;
    },
  };
}
