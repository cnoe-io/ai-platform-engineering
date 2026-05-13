import assert from "node:assert/strict";

import { REBAC_RESOURCE_FIXTURES } from "../../fixtures/rebac_resources";

const expectedTypes = [
  "organization",
  "user",
  "external_group",
  "team",
  "slack_workspace",
  "slack_channel",
  "agent",
  "mcp_server",
  "tool",
  "knowledge_base",
  "document",
  "skill",
  "task",
  "conversation",
  "admin_surface",
  "policy",
  "audit_log",
  "secret_ref",
  "system_config",
] as const;

const fixtureTypes = new Set(REBAC_RESOURCE_FIXTURES.map((fixture) => fixture.type));

for (const type of expectedTypes) {
  assert.ok(fixtureTypes.has(type), `missing ReBAC fixture for ${type}`);
}

for (const fixture of REBAC_RESOURCE_FIXTURES) {
  assert.ok(fixture.representativeActions.length > 0, `${fixture.type}:${fixture.id} has no actions`);
}

console.log("universal ReBAC matrix fixtures cover every protected resource type");
