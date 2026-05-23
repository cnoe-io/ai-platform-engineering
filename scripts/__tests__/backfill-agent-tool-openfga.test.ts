const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveAgentToolBackfillPlan,
} = require("../backfill-agent-tool-openfga.ts");

type OpenFgaTupleKey = import("../backfill-agent-tool-openfga").OpenFgaTupleKey;

function tupleKey(tuple: OpenFgaTupleKey): string {
  return `${tuple.user} ${tuple.relation} ${tuple.object}`;
}

test("derives agent-scoped OpenFGA tool tuples from allowed_tools", () => {
  const plan = deriveAgentToolBackfillPlan([
    {
      _id: "agent-test-april-2025",
      allowed_tools: {
        jira: ["search", "get_current_user_account_id"],
        github: [],
      },
    },
  ]);

  assert.deepEqual(plan.tuples.map(tupleKey).sort(), [
    "agent:agent-test-april-2025 caller tool:github/*",
    "agent:agent-test-april-2025 caller tool:jira/get_current_user_account_id",
    "agent:agent-test-april-2025 caller tool:jira/search",
  ]);
  assert.equal(plan.counts.agentsScanned, 1);
  assert.equal(plan.counts.agentsWithTools, 1);
  assert.equal(plan.counts.tuplesPlanned, 3);
});

test("skips invalid OpenFGA identifiers without emitting unsafe tuples", () => {
  const plan = deriveAgentToolBackfillPlan([
    {
      _id: "bad:id",
      allowed_tools: { jira: ["search"] },
    },
    {
      _id: "agent-ok",
      allowed_tools: { "bad:server": ["tool"], jira: ["bad:tool"] },
    },
  ]);

  assert.deepEqual(plan.tuples, []);
  assert.equal(plan.counts.invalidIdentifiers, 3);
  assert.match(plan.warnings.join("\n"), /invalid id/);
});

test("builds tuple diff that removes stale agent tool tuples", () => {
  const { buildAgentToolTupleDiff } = require("../backfill-agent-tool-openfga.ts");
  const diff = buildAgentToolTupleDiff({
    desiredTuples: [
      {
        user: "agent:test-april-2025",
        relation: "caller",
        object: "tool:jira/get_current_user_account_id",
      },
    ],
    existingTuples: [
      {
        user: "agent:test-april-2025",
        relation: "caller",
        object: "tool:jira/*",
      },
    ],
  });

  assert.deepEqual(diff, {
    writes: [
      {
        user: "agent:test-april-2025",
        relation: "caller",
        object: "tool:jira/get_current_user_account_id",
      },
    ],
    deletes: [
      {
        user: "agent:test-april-2025",
        relation: "caller",
        object: "tool:jira/*",
      },
    ],
  });
});
