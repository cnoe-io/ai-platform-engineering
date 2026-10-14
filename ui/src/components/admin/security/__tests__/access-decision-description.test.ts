import type { UnifiedAuditEvent } from "@/lib/rbac/types";
import { describeAccessDecision } from "../access-decision-description";

const base: UnifiedAuditEvent = {
  ts: "2026-10-13T12:00:00Z", type: "cas_decision", tenant_id: "default",
  action: "call", outcome: "deny", correlation_id: "request-1", source: "cas",
};

it.each([
  [{ reason_code: "AUTHZ_UNAVAILABLE", failed_gate: "caller_tool" }, "Authorization unavailable", "not proof of a missing permission"],
  [{ reason_code: "NO_CAPABILITY", failed_gate: "context" }, "Execution context rejected", "does not identify which condition"],
  [{ reason_code: "NO_CAPABILITY", failed_gate: "agent_tool" }, "Denied", "Agent → tool"],
  [{ reason_code: "INVALID_REQUEST" }, "Invalid request", "does not identify a missing grant"],
  [{ reason_code: "NOT_AUTHENTICATED" }, "Authentication rejected", "No resource-permission conclusion"],
  [{ outcome: "error" }, "Check failed", "without a permission verdict"],
  [{ outcome: "allow", count: 1 }, "Allowed (rollup)", "not an individual request receipt"],
  [{ outcome: "allow" }, "Allowed", "does not prove that the downstream tool ran"],
  [{ batch: true }, "Catalog lookup", "not a blocked access attempt"],
  [{ list_objects: true }, "Catalog lookup", "not a blocked access attempt"],
  [{ batch: true, reason_code: "AUTHZ_UNAVAILABLE" }, "Authorization unavailable", "not proof of a missing permission"],
  [{ failed_gate: "unknown" }, "Denied", "No more specific failed check"],
])("describes recorded evidence %j", (fields, label, detail) => {
  const result = describeAccessDecision({ ...base, ...fields } as UnifiedAuditEvent);
  expect(result.label).toBe(label);
  expect(result.explanation).toContain(detail);
});
