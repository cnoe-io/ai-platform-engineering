// assisted-by Codex Codex-sonnet-4-6
//
// Public API for the Centralized Authorization Service (CAS).
// Everything inside the BFF imports from here — never from engines/,
// compose.ts, or audit.ts directly. The ESLint boundary rule enforces this.

import type {
  Action,
  AuthorizeRequest,
  AuthorizeResult,
  DecisionContext,
  GrantIntent,
  ResourceType,
  Subject,
} from "./contract";
import { compose } from "./compose";
import { emitDecisionAudit, emitGrantAudit, emitMigrationComparison } from "./audit";
import { checkAuthz, checkAuthzBatch, type TimedAuthorizeResult } from "./client";
import {
  currentMigrationRevision,
  modeFor,
  routeAuthorization,
  type MigrationMode,
} from "./migration-router";
import { createOpenFgaEngine, createOpenFgaAdmin } from "./engines/openfga";
import { workflowDelegationPreCheck } from "./domains/workflow";

// ─── Singleton engine (module-level, reused across requests) ──────────────────

const engine = compose(createOpenFgaEngine(), {
  preCheck: async (req) => workflowDelegationPreCheck(req),
});

const admin = createOpenFgaAdmin();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a single authorization request. Never throws for DENY — returns
 * the decision in the result. The decision is always audited.
 */
export async function authorize(
  req: AuthorizeRequest,
  ctx: DecisionContext = {},
): Promise<AuthorizeResult> {
  const routed = await routeAuthorization(
    req,
    () => engine.check(req),
    (purpose, timeoutMs) => checkAuthz(req, purpose, timeoutMs),
    (comparison) => emitMigrationComparison({
      revision: comparison.revision,
      authoritativePath: comparison.authoritativePath,
      surface: "bff",
      resourceType: req.resource.type,
      action: req.action,
      legacy: comparison.legacy,
      authz: comparison.authz,
      correlationId: ctx.correlationId,
    }),
  );
  if (routed.authoritativePath === "LEGACY") {
    emitDecisionAudit(req.subject, req.resource, req.action, routed.result, ctx, req.trustedContext);
  }
  return routed.result;
}

/**
 * Batch evaluation: same subject + action across multiple resource ids.
 * Uses bounded-parallel checks internally. Each decision is audited.
 */
export async function authorizeMany(
  subject: Subject,
  action: Action,
  resourceType: ResourceType,
  ids: string[],
  ctx: DecisionContext = {},
): Promise<Map<string, AuthorizeResult>> {
  if (ids.length === 0) return new Map();
  const requests = ids.map((id): AuthorizeRequest => ({
    subject,
    action,
    resource: { type: resourceType, id },
  }));
  const revision = currentMigrationRevision();
  const modes = requests.map((request) => modeFor(revision, request));
  const legacyIndexes = modes
    .map((mode, index) => mode !== "AUTHZ_ONLY" ? index : -1)
    .filter((index) => index >= 0);
  const legacyStartedAt = performance.now();
  const legacyPromise = legacyIndexes.length > 0
    ? engine.batchCheck(
        subject,
        action,
        resourceType,
        legacyIndexes.map((index) => ids[index]),
      )
    : Promise.resolve(new Map<string, AuthorizeResult>());
  const authoritativeIndexes = modes
    .map((mode, index) => mode === "AUTHZ" || mode === "AUTHZ_ONLY" ? index : -1)
    .filter((index) => index >= 0);
  const shadowIndexes = modes
    .map((mode, index) => mode === "SHADOW" ? index : -1)
    .filter((index) => index >= 0);

  const authoritativePromise = authoritativeIndexes.length > 0
    ? checkAuthzBatch(
        authoritativeIndexes.map((index) => requests[index]),
        "authoritative",
      )
    : Promise.resolve([]);
  const shadowPromise = shadowIndexes.length > 0
    ? checkAuthzBatch(
        shadowIndexes.map((index) => requests[index]),
        "shadow",
        revision.shadow_timeout_ms ?? 100,
      )
    : Promise.resolve([]);
  const [legacyResults, authoritativeResults] = await Promise.all([
    legacyPromise,
    authoritativePromise,
  ]);
  const legacyDurationMs = performance.now() - legacyStartedAt;
  const authzByIndex = new Map<number, TimedAuthorizeResult>();
  authoritativeIndexes.forEach((index, offset) => authzByIndex.set(index, authoritativeResults[offset]));

  void shadowPromise.then((shadowResults) => {
    shadowIndexes.forEach((index, offset) => {
      const legacy = legacyResults.get(ids[index]);
      if (!legacy) return;
      emitBatchComparison(
        requests[index],
        modes[index],
        legacy,
        legacyDurationMs,
        shadowResults[offset],
        ctx,
      );
    });
  });

  const results = new Map<string, AuthorizeResult>();
  for (const [index, request] of requests.entries()) {
    const mode = modes[index];
    const authoritativePath = mode === "AUTHZ" || mode === "AUTHZ_ONLY" ? "AUTHZ" : "LEGACY";
    const result = authoritativePath === "AUTHZ"
      ? authzByIndex.get(index)?.result
      : legacyResults.get(ids[index]);
    const failClosed = result ?? { decision: "DENY" as const, reason: "AUTHZ_UNAVAILABLE" as const, retriable: true };
    results.set(ids[index], failClosed);
    if (authoritativePath === "LEGACY") {
      emitDecisionAudit(subject, request.resource, action, failClosed, ctx);
    } else if (mode === "AUTHZ") {
      const legacy = legacyResults.get(ids[index]);
      const authz = authzByIndex.get(index);
      if (legacy && authz) {
        emitBatchComparison(request, mode, legacy, legacyDurationMs, authz, ctx);
      }
    }
  }
  return results;
}

function emitBatchComparison(
  request: AuthorizeRequest,
  mode: MigrationMode,
  legacyResult: AuthorizeResult,
  legacyDurationMs: number,
  authz: TimedAuthorizeResult,
  ctx: DecisionContext,
): void {
  const revision = currentMigrationRevision();
  emitMigrationComparison({
    revision: revision.revision,
    authoritativePath: mode === "SHADOW" ? "LEGACY" : "AUTHZ",
    surface: "bff",
    resourceType: request.resource.type,
    action: request.action,
    legacy: {
      result: legacyResult,
      durationMs: legacyDurationMs,
      error: legacyResult.reason === "AUTHZ_UNAVAILABLE",
    },
    authz,
    correlationId: ctx.correlationId,
  });
}

/**
 * Guard variant. Throws {@link AuthzDeniedError} on DENY (including
 * AUTHZ_UNAVAILABLE). Use inside BFF route handlers where a denial should
 * stop the request.
 */
export async function authorizeOrThrow(
  req: AuthorizeRequest,
  ctx: DecisionContext = {},
): Promise<void> {
  const result = await authorize(req, ctx);
  if (result.decision === "DENY") {
    throw new AuthzDeniedError(result);
  }
}

/** Returns only the ids from `ids` that the subject may access. */
export async function filterAccessible(
  subject: Subject,
  action: Action,
  resourceType: ResourceType,
  ids: string[],
  ctx: DecisionContext = {},
): Promise<string[]> {
  if (ids.length === 0) return [];
  const results = await authorizeMany(subject, action, resourceType, ids, ctx);
  return ids.filter((id) => results.get(id)?.decision === "ALLOW");
}

// ─── Grant / Revoke (PAP) ─────────────────────────────────────────────────────

export async function grant(intent: GrantIntent, ctx: DecisionContext = {}): Promise<void> {
  try {
    await admin.grant(intent);
    await emitGrantAudit("grant", intent, ctx, { outcome: "success" });
  } catch (err) {
    await emitGrantAudit("grant", intent, ctx, { outcome: "error", reasonCode: "PDP_WRITE_FAILED" });
    throw err;
  }
}

export async function revoke(intent: GrantIntent, ctx: DecisionContext = {}): Promise<void> {
  try {
    await admin.revoke(intent);
    await emitGrantAudit("revoke", intent, ctx, { outcome: "success" });
  } catch (err) {
    await emitGrantAudit("revoke", intent, ctx, { outcome: "error", reasonCode: "PDP_WRITE_FAILED" });
    throw err;
  }
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class AuthzDeniedError extends Error {
  readonly result: AuthorizeResult;
  constructor(result: AuthorizeResult) {
    super(`Authorization denied: ${result.reason}`);
    this.name = "AuthzDeniedError";
    this.result = result;
  }
}

// ─── Tuple reconciliation (PAP batch writes) ──────────────────────────────────

export { reconcileTupleDiff, OpenFgaReconcileRequiredError } from "./reconcile";
export type { TupleReconcileContext } from "./reconcile";

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { describeFgaCheck, getEngineStats } from "./engines/openfga";
export type { EngineStats } from "./engines/openfga";

export type {
  Action,
  AuthorizeRequest,
  AuthorizeResult,
  DecisionContext,
  DecisionValue,
  Grantee,
  GrantIntent,
  ReasonCode,
  Resource,
  ResourceType,
  Subject,
  SubjectType,
} from "./contract";
