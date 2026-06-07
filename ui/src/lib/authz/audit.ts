// assisted-by claude code claude-opus-4-8
//
// CAS decision audit. Writes ONE event per decision to the shared
// `audit_events` collection, conforming to the UnifiedAuditEvent contract
// that the admin audit tab (`UnifiedAuditTab`) renders — so CAS decisions
// appear, typed and filterable, alongside existing auth/openfga_rebac events.
//
// Best-effort + fire-and-forget: a Mongo failure is logged but never blocks
// or changes the decision (the decision is the authoritative output).

import { createHash, randomUUID } from "crypto";

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";

import type { Action, AuthorizeResult, DecisionContext, Resource, Subject } from "./contract";

const AUDIT_EVENTS = "audit_events";
const SUBJECT_SALT = process.env.AUDIT_SUBJECT_SALT ?? "caipe-098-audit";

/**
 * Conforms to `AuditEventDocument` in the audit-events route. `outcome`
 * (not `decision`) and `resource_ref` (not split fields) are what the tab
 * reads; `resource_type` / `resource_id` are extra columns kept for stats
 * aggregation (the tab ignores unknown fields).
 */
export interface CasDecisionEvent {
  audit_event_id: string;
  ts: Date;
  type: "cas_decision";
  tenant_id: string;
  subject_hash: string;
  action: Action;
  outcome: "allow" | "deny";
  reason_code: AuthorizeResult["reason"];
  correlation_id: string;
  component: "cas";
  resource_ref: string;
  resource_type: string;
  resource_id: string;
  pdp: "openfga";
  source: "cas";
  trace_id?: string;
  span_id?: string;
}

function hashSubject(id: string): string {
  return "sha256:" + createHash("sha256").update(`${SUBJECT_SALT}:${id}`).digest("hex");
}

export function buildDecisionEvent(
  subject: Subject,
  resource: Resource,
  action: Action,
  result: AuthorizeResult,
  ctx: DecisionContext = {},
): CasDecisionEvent {
  return {
    audit_event_id: randomUUID(),
    ts: new Date(),
    type: "cas_decision",
    tenant_id: ctx.tenantId ?? process.env.TENANT_ID ?? "default",
    subject_hash: hashSubject(subject.id),
    action,
    outcome: result.decision === "ALLOW" ? "allow" : "deny",
    reason_code: result.reason,
    correlation_id: ctx.correlationId ?? randomUUID(),
    component: "cas",
    resource_ref: `${resource.type}:${resource.id}`,
    resource_type: resource.type,
    resource_id: resource.id,
    pdp: "openfga",
    source: "cas",
    ...(ctx.traceId ? { trace_id: ctx.traceId } : {}),
    ...(ctx.spanId ? { span_id: ctx.spanId } : {}),
  };
}

export function emitDecisionAudit(
  subject: Subject,
  resource: Resource,
  action: Action,
  result: AuthorizeResult,
  ctx: DecisionContext = {},
): void {
  if (!isMongoDBConfigured) return;

  const event = buildDecisionEvent(subject, resource, action, result, ctx);

  void (async () => {
    try {
      const coll = await getCollection<CasDecisionEvent>(AUDIT_EVENTS);
      await coll.insertOne(event);
    } catch (err) {
      console.warn("[cas/audit] Failed to persist decision event:", err);
    }
  })();
}
