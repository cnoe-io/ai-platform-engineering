import type { UnifiedAuditEvent } from "@/lib/rbac/types";

export const ACCESS_GATE_LABELS: Record<string, string> = {
  context: "Execution context",
  gateway: "Caller → gateway",
  server: "Caller → MCP server",
  agent: "Caller → agent",
  agent_tool: "Agent → tool",
  caller_tool: "Caller → tool / Search access",
};

/** Describe recorded evidence, not a fresh permission check or inferred grant. */
export function describeAccessDecision(event: UnifiedAuditEvent): { label: string; explanation: string } {
  if (event.reason_code === "AUTHZ_UNAVAILABLE") {
    return { label: "Authorization unavailable", explanation: "CAS could not evaluate access. The request was blocked safely; this is not proof of a missing permission." };
  }
  if (event.batch || event.list_objects) {
    return { label: "Catalog lookup", explanation: "This summarizes accessible resources, not a blocked access attempt." };
  }
  if (event.reason_code === "INVALID_REQUEST") {
    return { label: "Invalid request", explanation: "CAS rejected the request format. This does not identify a missing grant." };
  }
  if (event.reason_code === "NOT_AUTHENTICATED") {
    return { label: "Authentication rejected", explanation: "The recorded check rejected authentication. No resource-permission conclusion can be drawn." };
  }
  if (event.outcome === "allow") {
    if (event.count !== undefined) {
      return { label: "Allowed (rollup)", explanation: `This summarizes ${event.count} allowed checks, not an individual request receipt.` };
    }
    return { label: "Allowed", explanation: "CAS allowed this check. This does not prove that the downstream tool ran or succeeded." };
  }
  if (event.outcome !== "deny") {
    return { label: "Check failed", explanation: "The recorded check failed without a permission verdict. Inspect the recorded reason; do not infer a missing grant." };
  }
  if (event.failed_gate === "context") {
    return { label: "Execution context rejected", explanation: "The execution context was missing, expired or incorrectly bound. The record does not identify which condition occurred." };
  }
  if (event.failed_gate && ACCESS_GATE_LABELS[event.failed_gate]) {
    return { label: "Denied", explanation: `The ${ACCESS_GATE_LABELS[event.failed_gate]} check did not allow access. The record does not identify a missing team or grant.` };
  }
  return { label: "Denied", explanation: "The recorded check did not allow access. No more specific failed check or missing grant was recorded." };
}
