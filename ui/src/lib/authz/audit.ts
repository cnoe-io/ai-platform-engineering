// assisted-by Codex Codex-sonnet-4-6
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

import type {
  Action,
  AuthorizeResult,
  DecisionContext,
  GrantIntent,
  Resource,
  Subject,
  TrustedAuthorizeContext,
} from "./contract";

const AUDIT_EVENTS = "audit_events";
const SUBJECT_SALT = process.env.AUDIT_SUBJECT_SALT ?? "caipe-098-audit";

/**
 * Conforms to `AuditEventDocument` in the audit-events route. `outcome`
 * (not `decision`) and `resource_ref` (not split fields) are what the tab
 * reads; split resource fields, workflow context, and decision path are kept
 * so exports can explain where workflow-scoped CAS decisions came from.
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
  workflow_run_id?: string;
  decision_via?: string;
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
  trustedContext: TrustedAuthorizeContext = {},
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
    ...(trustedContext.workflowRunId ? { workflow_run_id: trustedContext.workflowRunId } : {}),
    ...(result.via ? { decision_via: result.via } : {}),
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
  trustedContext: TrustedAuthorizeContext = {},
): void {
  if (!isMongoDBConfigured) return;

  const event = buildDecisionEvent(subject, resource, action, result, ctx, trustedContext);

  void (async () => {
    try {
      const coll = await getCollection<CasDecisionEvent>(AUDIT_EVENTS);
      await coll.insertOne(event);
    } catch (err) {
      console.warn("[cas/audit] Failed to persist decision event:", err);
    }
  })();
}

export type GrantOperation = "grant" | "revoke";
export type GrantAuditOutcome = "success" | "error";

export interface GrantAuditOptions {
  outcome?: GrantAuditOutcome;
  /** Why the attempt failed (meta-authz deny, PDP error, etc.). */
  reasonCode?: string;
}

function principalRef(type: string, id?: string): string {
  if (type === "everyone") return "user:*";
  return `${type}:${id ?? ""}`;
}

function granteeLabel(g: GrantIntent["grantee"]): string {
  return principalRef(g.type, g.type === "everyone" ? undefined : g.id);
}

/**
 * Durable audit record for a grant/revoke attempt (success or failure).
 * Conforms to the unified audit tab — caller, grantee, resource, capability,
 * operation, outcome, reason, and tenant/correlation context are explicit.
 */
export interface CasGrantEvent {
  audit_event_id: string;
  ts: Date;
  type: "cas_grant";
  tenant_id: string;
  /** Hashed caller — who performed the policy change. */
  subject_hash: string;
  actor_hash: string;
  caller_ref: string;
  grantee_ref: string;
  action: Action;
  operation: GrantOperation;
  outcome: GrantAuditOutcome;
  reason_code?: string;
  resource_ref: string;
  resource_type: string;
  resource_id: string;
  correlation_id: string;
  component: "cas";
  pdp: "openfga";
  source: "cas";
  trace_id?: string;
  span_id?: string;
}

export function buildGrantEvent(
  operation: GrantOperation,
  intent: GrantIntent,
  ctx: DecisionContext = {},
  options: GrantAuditOptions = {},
): CasGrantEvent {
  if (!ctx.caller) {
    throw new Error("buildGrantEvent requires ctx.caller");
  }
  const outcome = options.outcome ?? "success";
  const callerRef = principalRef(ctx.caller.type, ctx.caller.id);
  return {
    audit_event_id: randomUUID(),
    ts: new Date(),
    type: "cas_grant",
    tenant_id: ctx.tenantId ?? process.env.TENANT_ID ?? "default",
    subject_hash: hashSubject(ctx.caller.id),
    actor_hash: hashSubject(ctx.caller.id),
    caller_ref: callerRef,
    grantee_ref: granteeLabel(intent.grantee),
    action: intent.capability,
    operation,
    outcome,
    resource_ref: `${intent.resource.type}:${intent.resource.id}`,
    resource_type: intent.resource.type,
    resource_id: intent.resource.id,
    correlation_id: ctx.correlationId ?? randomUUID(),
    component: "cas",
    pdp: "openfga",
    source: "cas",
    ...(options.reasonCode ? { reason_code: options.reasonCode } : {}),
    ...(ctx.traceId ? { trace_id: ctx.traceId } : {}),
    ...(ctx.spanId ? { span_id: ctx.spanId } : {}),
  };
}

/** One audit event per grant/revoke attempt → unified `audit_events`. */
export async function emitGrantAudit(
  operation: GrantOperation,
  intent: GrantIntent,
  ctx: DecisionContext = {},
  options: GrantAuditOptions = {},
): Promise<void> {
  if (!isMongoDBConfigured || !ctx.caller) return;

  const event = buildGrantEvent(operation, intent, ctx, options);

  try {
    const coll = await getCollection<CasGrantEvent>(AUDIT_EVENTS);
    await coll.insertOne(event);
  } catch (err) {
    console.warn("[cas/audit] Failed to persist grant event:", err);
  }
}
