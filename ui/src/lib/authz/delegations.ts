import { randomUUID } from "crypto";
import { emitDelegationAudit } from "./audit";
import type { DecisionContext, Subject } from "./contract";
import {
  type DelegatedRequest, type DelegationCheck, type DelegationDecision, type DelegationIdentity,
  type DelegationIntent, type DelegationReason, type DelegationRecord,
} from "./delegation-contract";
import { insertDelegation, readDelegation, revokeDelegationRecord } from "./delegation-store";
import { checkDelegationPermission } from "./engines/openfga";
import { HttpAuthzError } from "./http";

function approvalReason(record: DelegationRecord): DelegationReason {
  if (record.revoked_at) return "DELEGATION_REVOKED";
  return Date.parse(record.expires_at) > Date.now() ? "OK" : "DELEGATION_EXPIRED";
}

async function permissions(
  record: Pick<DelegationRecord, "user_id" | "service">, request: DelegatedRequest,
  signal: AbortSignal, checks: DelegationCheck[],
): Promise<DelegationReason> {
  const principals: [DelegationCheck["gate"], Subject, DelegationReason][] = [
    ["service_permission", { type: "service_account", id: record.service.id }, "SERVICE_NOT_ALLOWED"],
    ["user_permission", { type: "user", id: record.user_id }, "USER_NOT_ALLOWED"],
  ];
  for (const [gate, subject, denied] of principals) {
    const result = await checkDelegationPermission({ subject, resource: request.resource, action: request.action }, signal);
    const reason = result.reason === "AUTHZ_UNAVAILABLE" ? result.reason : result.decision === "ALLOW" ? "OK" : denied;
    checks.push({ gate, decision: result.decision, reason });
    if (reason !== "OK") return reason;
  }
  return "OK";
}

export async function createDelegation(
  identity: DelegationIdentity, intent: DelegationIntent, ctx: DecisionContext, id: string,
): Promise<DelegationRecord> {
  if (identity.subject.type !== "user") throw new HttpAuthzError(403, "FORBIDDEN", "Only a user may approve delegation");
  const signal = AbortSignal.timeout(5000);
  for (const permission of intent.scope) {
    const checks: DelegationCheck[] = [];
    const reason = await permissions({ user_id: identity.subject.id, service: intent.service },
      { ...permission, job_id: intent.job_id }, signal, checks);
    if (reason !== "OK") {
      emitDelegationAudit("create", identity, undefined, id, reason, ctx, checks, permission);
      throw new HttpAuthzError(reason === "AUTHZ_UNAVAILABLE" ? 503 : 403,
        reason === "AUTHZ_UNAVAILABLE" ? "AUTHZ_UNAVAILABLE" : "FORBIDDEN", `Cannot approve delegation: ${reason}`);
    }
  }
  if (identity.expiresAt * 1000 <= Date.now() || Date.parse(intent.expires_at) <= Date.now()) {
    throw new HttpAuthzError(401, "NOT_AUTHENTICATED", "Identity or approval expired during validation");
  }
  const record = await insertDelegation(identity, intent, id);
  emitDelegationAudit("create", identity, record, record._id, "OK", ctx);
  return record;
}

/** Deliberately no org-audit/admin bypass: only this approval's user owns it. */
export async function inspectDelegation(id: string, identity: DelegationIdentity): Promise<DelegationRecord | null> {
  const record = await readDelegation(id);
  if (!record || record.issuer !== identity.issuer) return null;
  if (identity.subject.type === "user") return record.user_id === identity.subject.id ? record : null;
  return record.service.id === identity.subject.id && record.service.client_id === identity.clientId ? record : null;
}

export async function revokeDelegation(id: string, identity: DelegationIdentity, ctx: DecisionContext): Promise<DelegationRecord | null> {
  if (identity.subject.type !== "user") throw new HttpAuthzError(403, "FORBIDDEN", "Only the approving user may revoke delegation");
  const record = await revokeDelegationRecord(id, identity);
  emitDelegationAudit("revoke", identity, record ?? undefined, id, record ? "OK" : "DELEGATION_NOT_FOUND", ctx);
  return record;
}

export async function authorizeDelegated(
  id: string, identity: DelegationIdentity, request: DelegatedRequest, ctx: DecisionContext,
): Promise<DelegationDecision> {
  const decisionId = randomUUID();
  const checks: DelegationCheck[] = [];
  let bound: DelegationRecord | undefined;
  const finish = (reason: DelegationReason): DelegationDecision => {
    emitDelegationAudit("check", identity, bound, id, reason, ctx, checks, request, decisionId);
    return { decision: reason === "OK" ? "ALLOW" : "DENY", reason, retriable: reason === "AUTHZ_UNAVAILABLE",
      ttl_seconds: 0, decision_id: decisionId, delegation_id: id };
  };
  const gate = (name: DelegationCheck["gate"], reason: DelegationReason) => {
    checks.push({ gate: name, decision: reason === "OK" ? "ALLOW" : "DENY", reason });
    return reason === "OK";
  };
  try {
    const record = await readDelegation(id);
    if (!record) { gate("binding", "DELEGATION_NOT_FOUND"); return finish("DELEGATION_NOT_FOUND"); }
    if (!gate("binding", identity.subject.type === "service_account" && record.issuer === identity.issuer &&
      record.service.id === identity.subject.id && record.service.client_id === identity.clientId && record.job_id === request.job_id
      ? "OK" : "DELEGATION_BINDING_MISMATCH")) return finish("DELEGATION_BINDING_MISMATCH");
    bound = record;
    const state = approvalReason(record);
    if (!gate("approval", state)) return finish(state);
    if (!gate("scope", record.scope.some((item) => item.action === request.action &&
      item.resource.type === request.resource.type && item.resource.id === request.resource.id) ? "OK" : "DELEGATION_SCOPE_MISMATCH")) {
      return finish("DELEGATION_SCOPE_MISMATCH");
    }
    const reason = await permissions(record, request, AbortSignal.timeout(5000), checks);
    if (reason !== "OK") return finish(reason);
    // A revocation/expiry while graph checks were in flight must not reuse the
    // earlier approval. This is a point-in-time decision, not an execution lease.
    const current = await readDelegation(id);
    if (!current) { gate("approval_recheck", "DELEGATION_NOT_FOUND"); return finish("DELEGATION_NOT_FOUND"); }
    bound = current;
    const latest = current.version !== record.version ? "DELEGATION_REVOKED" : approvalReason(current);
    if (!gate("approval_recheck", latest)) return finish(latest);
    if (identity.expiresAt * 1000 <= Date.now()) return finish("NOT_AUTHENTICATED");
    return finish("OK");
  } catch (error) {
    console.warn("[cas/delegation] Decision unavailable", { decisionId, name: error instanceof Error ? error.name : "UnknownError" });
    return finish("AUTHZ_UNAVAILABLE");
  }
}
