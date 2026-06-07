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
  GrantIntent,
  ResourceType,
  Subject,
} from "./contract";
import { compose } from "./compose";
import { emitDecisionAudit, emitGrantAudit } from "./audit";
import { createOpenFgaAdmin, createOpenFgaEngine } from "./engines/openfga";

// ─── Product policy layered over the raw PDP ──────────────────────────────────

const ORG_KEY = process.env.CAIPE_ORG_KEY?.trim() || "caipe";

/** Mirrors resource-authz.ts `isOrgAdminBypassKillSwitchEnabled`. */
function orgAdminBypassDisabled(): boolean {
  const raw = process.env.RAG_ADMIN_BYPASS_DISABLED;
  return raw === "1" || raw?.trim().toLowerCase() === "true";
}

// The raw OpenFGA engine. Used both as the fallback decider and — directly,
// to avoid recursion — for the org-admin probe inside preCheck.
const rawEngine = createOpenFgaEngine();

/**
 * Product policy that runs before the raw PDP: the org-admin bypass — mirrors
 * the app's `isOrgAdmin` short-circuit so CAS decisions match what the
 * application actually enforces. Honors the RAG_ADMIN_BYPASS_DISABLED
 * kill-switch.
 */
async function preCheck(req: AuthorizeRequest): Promise<AuthorizeResult | null> {
  const isOrgManageProbe = req.resource.type === "organization" && req.action === "manage";
  if (!orgAdminBypassDisabled() && req.subject.type === "user" && !isOrgManageProbe) {
    const admin = await rawEngine.check({
      subject: req.subject,
      resource: { type: "organization", id: ORG_KEY },
      action: "manage",
    });
    if (admin.decision === "ALLOW") {
      return { decision: "ALLOW", reason: "OK", retriable: false, via: "org_admin" };
    }
  }
  return null;
}

// ─── Singleton engine (module-level, reused across requests) ──────────────────

const engine = compose(rawEngine, { preCheck });

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

// ─── Administration (PAP) ─────────────────────────────────────────────────────

const policyAdmin = createOpenFgaAdmin();

/** Write a grant (intent-based). Audited as `cas_grant`. Idempotent. */
export async function grant(intent: GrantIntent, ctx: DecisionContext = {}): Promise<void> {
  await policyAdmin.grant(intent);
  emitGrantAudit("grant", intent, ctx);
}

/** Remove a grant (intent-based). Audited as `cas_grant`. Idempotent. */
export async function revoke(intent: GrantIntent, ctx: DecisionContext = {}): Promise<void> {
  await policyAdmin.revoke(intent);
  emitGrantAudit("revoke", intent, ctx);
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
  Grantee,
  GranteeType,
  GrantIntent,
  ReasonCode,
  Resource,
  ResourceType,
  Subject,
  SubjectType,
} from "./contract";
