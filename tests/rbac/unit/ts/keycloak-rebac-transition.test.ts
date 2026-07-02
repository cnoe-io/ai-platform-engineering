import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const matrix = readFileSync("tests/rbac/rbac-matrix.yaml", "utf8");

assert.ok(
  matrix.includes("ui-bff-post-api-rbac-enforcement-comparison"),
  "RBAC matrix must cover the role-vs-ReBAC enforcement comparison endpoint"
);
assert.ok(
  matrix.includes("Compares transitional Keycloak realm role decisions against ReBAC decisions."),
  "RBAC matrix must document the Keycloak realm-role transition purpose"
);
assert.ok(
  matrix.includes("resource: admin_ui") && matrix.includes("scope: view"),
  "enforcement comparison endpoint must be admin-ui view gated"
);

console.log("Keycloak/ReBAC transition matrix coverage is present");
