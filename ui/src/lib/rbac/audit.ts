import { createHash, randomUUID } from "crypto";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type {
  AuditEvent,
  AuditOutcome,
  AuditPdp,
  AuditReasonCode,
  RbacResource,
} from "./types";

const SUBJECT_SALT = process.env.AUDIT_SUBJECT_SALT || "caipe-098-audit";

const AUTHORIZATION_DECISION_RECORDS = "authorization_decision_records";
const AUDIT_EVENTS = "audit_events";

/**
 * Persist audit row shape for MongoDB (`ts` as BSON Date per data-model.md).
 */
type AuthorizationDecisionDocument = Omit<AuditEvent, "ts"> & { ts: Date };

function persistAuthzDecisionToMongo(event: AuditEvent): void {
  if (!isMongoDBConfigured) {
    return;
  }

  const doc: AuthorizationDecisionDocument = {
    ...event,
    ts: new Date(event.ts),
  };

  void (async () => {
    try {
      const coll = await getCollection<AuthorizationDecisionDocument>(
        AUTHORIZATION_DECISION_RECORDS,
      );
      await coll.insertOne(doc);
    } catch (err) {
      console.warn(
        "[rbac/audit] Failed to persist authorization_decision_record to MongoDB:",
        err,
      );
    }
  })();
}

/**
 * Dual-write: also persist to the unified ``audit_events`` collection (FR-037).
 */
function persistToUnifiedAuditEvents(event: AuditEvent, email?: string): void {
  if (!isMongoDBConfigured) {
    return;
  }

  const doc = {
    ts: new Date(event.ts),
    type: "auth" as const,
    tenant_id: event.tenant_id,
    subject_hash: event.subject_hash,
    action: event.capability,
    outcome: event.outcome,
    reason_code: event.reason_code,
    correlation_id: event.correlation_id,
    component: event.component,
    resource_ref: event.resource_ref,
    pdp: event.pdp,
    source: "bff" as const,
    ...(event.actor_hash ? { actor_hash: event.actor_hash } : {}),
    ...(email ? { user_email: email } : {}),
  };

  void (async () => {
    try {
      const coll = await getCollection(AUDIT_EVENTS);
      await coll.insertOne(doc);
    } catch (err) {
      console.warn(
        "[rbac/audit] Failed to persist to audit_events:",
        err,
      );
    }
  })();
}

function hashSubject(sub: string): string {
  return `sha256:${createHash("sha256").update(`${SUBJECT_SALT}:${sub}`).digest("hex")}`;
}

export interface LogAuthzDecisionParams {
  tenantId: string;
  sub: string;
  actorSub?: string;
  resource: RbacResource;
  scope: string;
  outcome: AuditOutcome;
  reasonCode: AuditReasonCode;
  pdp: AuditPdp;
  resourceRef?: string;
  correlationId?: string;
  email?: string;
}

/**
 * Emit a structured authorization decision audit event.
 * Writes to stdout as JSON — collected by the log aggregation pipeline.
 * When MongoDB is configured, also inserts into `authorization_decision_records` (fire-and-forget).
 */
export function logAuthzDecision(params: LogAuthzDecisionParams): AuditEvent {
  const event: AuditEvent = {
    ts: new Date().toISOString(),
    tenant_id: params.tenantId,
    subject_hash: hashSubject(params.sub),
    actor_hash: params.actorSub ? hashSubject(params.actorSub) : undefined,
    capability: `${params.resource}#${params.scope}`,
    component: params.resource,
    resource_ref: params.resourceRef,
    outcome: params.outcome,
    reason_code: params.reasonCode,
    pdp: params.pdp,
    correlation_id: params.correlationId || randomUUID(),
  };

  console.log(JSON.stringify(event));
  persistAuthzDecisionToMongo(event);
  persistToUnifiedAuditEvents(event, params.email);
  return event;
}
