// assisted-by claude code claude-opus-4-8
//
// Public API for the Centralized Authorization Service (CAS).
// Everything inside the BFF imports from here — never from engines/,
// compose.ts, or audit.ts directly. The ESLint boundary rule enforces this.

import type {
  Action,
  AuthorizeRequest,
  AuthorizeResult,
  DecisionContext,
  ResourceType,
  Subject,
} from "./contract";
import { compose } from "./compose";
import { emitDecisionAudit } from "./audit";
import { createOpenFgaEngine } from "./engines/openfga";
import { workflowDelegationPreCheck } from "./domains/workflow";

// ─── Singleton engine (module-level, reused across requests) ──────────────────

const engine = compose(createOpenFgaEngine(), {
  preCheck: async (req) => workflowDelegationPreCheck(req),
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a single authorization request. Never throws for DENY — returns
 * the decision in the result. The decision is always audited.
 */
export async function authorize(
  req: AuthorizeRequest,
  ctx: DecisionContext = {},
): Promise<AuthorizeResult> {
  const result = await engine.check(req);
  emitDecisionAudit(req.subject, req.resource, req.action, result, ctx);
  return result;
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
  const results = await engine.batchCheck(subject, action, resourceType, ids);
  for (const [id, result] of results) {
    emitDecisionAudit(subject, { type: resourceType, id }, action, result, ctx);
  }
  return results;
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

// ─── Error type ───────────────────────────────────────────────────────────────

export class AuthzDeniedError extends Error {
  readonly result: AuthorizeResult;
  constructor(result: AuthorizeResult) {
    super(`Authorization denied: ${result.reason}`);
    this.name = "AuthzDeniedError";
    this.result = result;
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { describeFgaCheck, getEngineStats } from "./engines/openfga";
export type { EngineStats } from "./engines/openfga";

export type {
  Action,
  AuthorizeRequest,
  AuthorizeResult,
  DecisionContext,
  DecisionValue,
  ReasonCode,
  Resource,
  ResourceType,
  Subject,
  SubjectType,
} from "./contract";
