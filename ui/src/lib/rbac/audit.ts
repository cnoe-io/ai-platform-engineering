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
  return event;
}
