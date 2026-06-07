// assisted-by claude code claude-opus-4-8
//
// Shared HTTP-layer helpers for the /api/authz/v1 routes: caller resolution,
// input validation, and subject-binding. These enforce the trust boundary —
// see spec §6 (threats 1–3). The rule of thumb: FAIL CLOSED. If we cannot
// positively establish the caller's verified subject, we reject.

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { authorize } from "./index";
import type {
  Action,
  DecisionContext,
  Resource,
  ResourceType,
  Subject,
  SubjectType,
} from "./contract";

const ORG_KEY = process.env.CAIPE_ORG_KEY ?? "caipe";
const ID_MAX_LEN = 256;

// Safe id charset: alnum plus the characters that appear in Keycloak subs
// (UUID), emails (`. _ % + - @`). Deliberately EXCLUDES:
//   *  — wildcard (would let a caller probe `agent:*` public-share tuples)
//   #  — OpenFGA relation separator
//   :  — OpenFGA type separator
//   /  — path traversal
// so a caller can never smuggle OpenFGA structure through an id field.
const ID_PATTERN = /^[A-Za-z0-9._%+\-@]+$/;

const SUBJECT_TYPES: ReadonlySet<string> = new Set<SubjectType>(["user", "service_account"]);
const RESOURCE_TYPES: ReadonlySet<string> = new Set<ResourceType>([
  "agent", "skill", "mcp_tool", "knowledge_base", "data_source",
  "task", "slack_channel", "webex_space", "organization", "team", "conversation",
]);
const ACTIONS: ReadonlySet<string> = new Set<Action>([
  "discover", "read", "read-metadata", "use", "write", "create",
  "manage", "share", "delete", "ingest", "call", "invoke", "audit",
]);

// ─── Meta errors (HTTP-level failures, distinct from a DENY decision) ─────────

export type MetaCode = "NOT_AUTHENTICATED" | "FORBIDDEN" | "INVALID_REQUEST" | "AUTHZ_UNAVAILABLE";

export class HttpAuthzError extends Error {
  constructor(
    readonly status: number,
    readonly code: MetaCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpAuthzError";
  }
}

export function metaErrorResponse(err: HttpAuthzError): NextResponse {
  return NextResponse.json(
    { error: err.message, code: err.code, retriable: err.code === "AUTHZ_UNAVAILABLE" },
    { status: err.status },
  );
}

// ─── Caller resolution (fail-closed) ──────────────────────────────────────────

export interface Caller {
  type: SubjectType;
  id: string;
}

/**
 * Returns the verified caller identity, or null if no stable subject can be
 * established (catalog-key / local-skills tokens carry no `sub`). Callers
 * without a subject must be rejected with 401 — they are authenticated but
 * cannot be bound to a subject, so they may not evaluate per-subject decisions.
 */
export function resolveCaller(session: unknown): Caller | null {
  if (!session || typeof session !== "object") return null;
  const s = session as { sub?: unknown; isServiceAccount?: unknown };
  const sub = typeof s.sub === "string" ? s.sub.trim() : "";
  if (!sub) return null;
  return { type: s.isServiceAccount === true ? "service_account" : "user", id: sub };
}

export function decisionContext(session: unknown): DecisionContext {
  let tenantId: string | undefined;
  if (session && typeof session === "object") {
    const org = (session as { org?: unknown }).org;
    if (typeof org === "string" && org.trim()) tenantId = org.trim();
  }
  return { tenantId, correlationId: randomUUID() };
}

// ─── Input validation ─────────────────────────────────────────────────────────

export function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= ID_MAX_LEN &&
    ID_PATTERN.test(value)
  );
}

export function parseSubject(raw: unknown): Subject {
  if (!raw || typeof raw !== "object") {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "subject is required");
  }
  const r = raw as Record<string, unknown>;
  if (!SUBJECT_TYPES.has(r.type as string)) {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "subject.type must be 'user' or 'service_account'");
  }
  if (!isValidId(r.id)) {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "subject.id is missing or contains invalid characters");
  }
  return { type: r.type as SubjectType, id: r.id as string };
}

export function parseResource(raw: unknown): Resource {
  if (!raw || typeof raw !== "object") {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "resource is required");
  }
  const r = raw as Record<string, unknown>;
  if (!RESOURCE_TYPES.has(r.type as string)) {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "resource.type is not a recognized resource type");
  }
  if (!isValidId(r.id)) {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "resource.id is missing or contains invalid characters");
  }
  return { type: r.type as ResourceType, id: r.id as string };
}

export function parseAction(raw: unknown): Action {
  if (!ACTIONS.has(raw as string)) {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "action is not a recognized action");
  }
  return raw as Action;
}

export function parseResourceType(raw: unknown): ResourceType {
  if (!RESOURCE_TYPES.has(raw as string)) {
    throw new HttpAuthzError(400, "INVALID_REQUEST", "resource_type is not a recognized resource type");
  }
  return raw as ResourceType;
}

// ─── Subject-binding (the core trust-boundary control) ────────────────────────

/**
 * A caller may only evaluate decisions for its OWN subject. Cross-subject
 * evaluation (one principal asking about another) requires `can_audit` on the
 * organization — the admin/explain capability. This single rule closes both
 * forged-subject (threat #1) and impersonation (threat #2): the OBO flow works
 * naturally because a bot presents the *user's* token, so caller == subject.
 */
export async function enforceSubjectBinding(
  caller: Caller,
  subject: Subject,
  ctx: DecisionContext,
): Promise<void> {
  if (subject.type === caller.type && subject.id === caller.id) return;

  const audit = await authorize(
    { subject: caller, resource: { type: "organization", id: ORG_KEY }, action: "audit" },
    ctx,
  );
  if (audit.decision !== "ALLOW") {
    throw new HttpAuthzError(403, "FORBIDDEN", "You may only evaluate decisions for your own subject");
  }
}

/** Unconditional can_audit gate for the admin /explain endpoint. */
export async function requireAuditCapability(caller: Caller, ctx: DecisionContext): Promise<void> {
  const audit = await authorize(
    { subject: caller, resource: { type: "organization", id: ORG_KEY }, action: "audit" },
    ctx,
  );
  if (audit.decision !== "ALLOW") {
    throw new HttpAuthzError(403, "FORBIDDEN", "can_audit permission is required to use /explain");
  }
}
