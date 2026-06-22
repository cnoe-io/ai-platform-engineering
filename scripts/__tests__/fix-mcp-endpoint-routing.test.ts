// assisted-by Codex Codex-sonnet-4-6

/**
 * Unit tests for the one-shot AgentGateway MCP endpoint repair script.
 *
 * Run:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/__tests__/fix-mcp-endpoint-routing.test.ts
 *
 * The script's IO half (Mongo client, env-driven configuration) is left
 * to manual verification because it requires a live Mongo. Both pure
 * pieces — endpoint normalisation and the repair-plan classifier — are
 * exported and covered here.
 *
 * History: this test set was deleted in a previous session because the
 * runner was thought to be broken. It isn't — the documented invocation
 * (`npx ts-node --compiler-options '{"module":"CommonJS"}'`) works
 * fine; the prior session was using `node --import tsx/esm` instead.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRepairPlan,
  normalizeMcpEndpointForServer,
} = require("../fix-mcp-endpoint-routing.ts");

type McpServerEndpointDoc =
  import("../fix-mcp-endpoint-routing").McpServerEndpointDoc;

const BASE = "http://agentgateway:4000";

// ---- normaliseMcpEndpointForServer (pure helper) -------------------------

test("normaliseMcpEndpointForServer rewrites bare gateway base to /mcp/<id>", () => {
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: "http://agentgateway:4000/mcp",
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    "http://agentgateway:4000/mcp/confluence",
  );
});

test("normaliseMcpEndpointForServer rewrites bare gateway origin (no /mcp suffix)", () => {
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: "http://agentgateway:4000",
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    "http://agentgateway:4000/mcp/confluence",
  );
});

test("normaliseMcpEndpointForServer collapses trailing slashes before rewriting", () => {
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: "http://agentgateway:4000/mcp/",
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    "http://agentgateway:4000/mcp/confluence",
  );
});

test("normaliseMcpEndpointForServer leaves already-canonical endpoints alone", () => {
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: "http://agentgateway:4000/mcp/confluence",
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    "http://agentgateway:4000/mcp/confluence",
  );
});

test("normaliseMcpEndpointForServer rewrites mismatched target suffix to match serverId", () => {
  // The endpoint says /mcp/jira but the server id is confluence — the
  // serverId is authoritative because the BFF route handler keys
  // routing by id. The script repairs to /mcp/confluence.
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: "http://agentgateway:4000/mcp/jira",
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    "http://agentgateway:4000/mcp/confluence",
  );
});

test("normaliseMcpEndpointForServer leaves direct upstream endpoints alone", () => {
  // The endpoint points at a service that is NOT AgentGateway. Rewriting
  // would break stdio/in-cluster paths.
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: "http://mcp-confluence:8000/mcp",
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    "http://mcp-confluence:8000/mcp",
  );
});

test("normaliseMcpEndpointForServer returns undefined endpoint untouched", () => {
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: undefined,
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    undefined,
  );
});

test("normaliseMcpEndpointForServer returns empty string untouched (stdio probe)", () => {
  assert.equal(
    normalizeMcpEndpointForServer({
      endpoint: "",
      serverId: "confluence",
      agentGatewayBaseUrl: BASE,
    }),
    "",
  );
});

test("normaliseMcpEndpointForServer is idempotent for the canonical form", () => {
  const once = normalizeMcpEndpointForServer({
    endpoint: "http://agentgateway:4000/mcp",
    serverId: "confluence",
    agentGatewayBaseUrl: BASE,
  });
  const twice = normalizeMcpEndpointForServer({
    endpoint: once,
    serverId: "confluence",
    agentGatewayBaseUrl: BASE,
  });
  assert.equal(twice, once);
});

// ---- buildRepairPlan (the script's classifier) ---------------------------

test("buildRepairPlan flags bare gateway endpoint as bare_gateway_base", () => {
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "http://agentgateway:4000/mcp",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 1);
  assert.deepEqual(plan.candidates[0], {
    id: "confluence",
    currentEndpoint: "http://agentgateway:4000/mcp",
    proposedEndpoint: "http://agentgateway:4000/mcp/confluence",
    reason: "bare_gateway_base",
  });
  assert.equal(plan.counts.proposed, 1);
  assert.equal(plan.counts.healthy, 0);
});

test("buildRepairPlan flags gateway origin (no /mcp) as gateway_root_only", () => {
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "http://agentgateway:4000",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].reason, "gateway_root_only");
  assert.equal(
    plan.candidates[0].proposedEndpoint,
    "http://agentgateway:4000/mcp/confluence",
  );
});

test("buildRepairPlan flags wrong-target suffix as wrong_target_suffix", () => {
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "http://agentgateway:4000/mcp/jira",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].reason, "wrong_target_suffix");
  assert.equal(
    plan.candidates[0].proposedEndpoint,
    "http://agentgateway:4000/mcp/confluence",
  );
});

test("buildRepairPlan leaves healthy canonical rows alone (counts.healthy)", () => {
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "http://agentgateway:4000/mcp/confluence",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.counts.healthy, 1);
  assert.equal(plan.counts.proposed, 0);
});

test("buildRepairPlan leaves direct upstream rows alone (counts.untouchedDirectUpstream)", () => {
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "http://mcp-confluence:8000/mcp",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.counts.untouchedDirectUpstream, 1);
});

test("buildRepairPlan refuses to mutate config_driven rows even when they're broken", () => {
  // Config-driven servers live in agentgateway/config.yaml — the script
  // must not silently rewrite Mongo for them, because the next deploy
  // would overwrite the fix with the bad config value.
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "http://agentgateway:4000/mcp",
        config_driven: true,
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.counts.untouchedConfigDriven, 1);
});

test("buildRepairPlan ignores rows with no endpoint (stdio / non-http transport)", () => {
  const plan = buildRepairPlan(
    [
      {
        _id: "stdio-server",
        endpoint: "",
      } as McpServerEndpointDoc,
      {
        _id: "no-endpoint",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.counts.untouchedNonHttpTransports, 2);
});

test("buildRepairPlan skips rows with no _id", () => {
  // A row without an _id can't be safely targeted by updateOne. Skipping
  // is the conservative choice; the row will surface as 'scanned' but
  // not 'proposed'.
  const plan = buildRepairPlan(
    [
      {
        endpoint: "http://agentgateway:4000/mcp",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.counts.scanned, 1);
});

test("buildRepairPlan handles a mixed corpus correctly", () => {
  // Realistic Mongo state when the bug first surfaced: one broken row,
  // one already-fixed row, one direct upstream, one config-driven.
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "http://agentgateway:4000/mcp",
      },
      {
        _id: "jira",
        endpoint: "http://agentgateway:4000/mcp/jira",
      },
      {
        _id: "argocd",
        endpoint: "http://mcp-argocd:8000/mcp",
      },
      {
        _id: "github",
        endpoint: "http://agentgateway:4000/mcp",
        config_driven: true,
      },
    ] as McpServerEndpointDoc[],
    BASE,
  );

  // Only confluence is rewritten.
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].id, "confluence");
  assert.equal(plan.counts.scanned, 4);
  assert.equal(plan.counts.proposed, 1);
  assert.equal(plan.counts.healthy, 1);
  assert.equal(plan.counts.untouchedDirectUpstream, 1);
  assert.equal(plan.counts.untouchedConfigDriven, 1);
});

test("buildRepairPlan tolerates ObjectId-shaped _id values", () => {
  // Real Mongo rows have ObjectId `_id`, not string. The script must
  // String()-coerce so the dry-run output and the updateOne filter both
  // use a stable identifier.
  const plan = buildRepairPlan(
    [
      {
        _id: {
          toString() {
            return "507f1f77bcf86cd799439011";
          },
        } as unknown as McpServerEndpointDoc["_id"],
        endpoint: "http://agentgateway:4000/mcp",
      } as McpServerEndpointDoc,
    ],
    BASE,
  );

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].id, "507f1f77bcf86cd799439011");
});

test("buildRepairPlan respects a custom AgentGateway base URL", () => {
  // Operators sometimes route AGW through an ingress or a node-port.
  // The script must compare origins, not hard-code agentgateway:4000.
  const plan = buildRepairPlan(
    [
      {
        _id: "confluence",
        endpoint: "https://agw.internal.example.com/mcp",
      } as McpServerEndpointDoc,
    ],
    "https://agw.internal.example.com",
  );

  assert.equal(plan.candidates.length, 1);
  assert.equal(
    plan.candidates[0].proposedEndpoint,
    "https://agw.internal.example.com/mcp/confluence",
  );
});
