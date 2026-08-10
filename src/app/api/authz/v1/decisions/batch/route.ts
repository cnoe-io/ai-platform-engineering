// assisted-by Codex Codex-sonnet-4-6
//
// POST /api/authz/v1/decisions/batch — batch decision: one subject + action
// across a list of resource ids. Returns one Decision per id. Used for
// list-filtering (accessible agents, datasources, workflow configs, …).

import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { authorizeMany } from "@/lib/authz";
import {
  HttpAuthzError,
  decisionContext,
  enforceSubjectBinding,
  isValidId,
  metaErrorResponse,
  parseAction,
  parseResourceType,
  parseSubject,
  resolveCaller,
} from "@/lib/authz/http";

export const dynamic = "force-dynamic";

const MAX_IDS = 200;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let session: unknown;
  try {
    session = (await getAuthFromBearerOrSession(request)).session;
  } catch {
    return metaErrorResponse(new HttpAuthzError(401, "NOT_AUTHENTICATED", "Authentication required"));
  }

  const caller = resolveCaller(session);
  if (!caller) {
    return metaErrorResponse(new HttpAuthzError(401, "NOT_AUTHENTICATED", "Authentication required"));
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpAuthzError(400, "INVALID_REQUEST", "Request body must be valid JSON");
    }
    if (!body || typeof body !== "object") {
      throw new HttpAuthzError(400, "INVALID_REQUEST", "Request body must be an object");
    }
    const b = body as Record<string, unknown>;

    const subject = parseSubject(b.subject);
    const action = parseAction(b.action);
    const resourceType = parseResourceType(b.resource_type);
    const ctx = decisionContext(session);

    if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > MAX_IDS) {
      throw new HttpAuthzError(400, "INVALID_REQUEST", `ids must be a non-empty array of at most ${MAX_IDS} items`);
    }
    if (!b.ids.every(isValidId)) {
      throw new HttpAuthzError(400, "INVALID_REQUEST", "ids contains an invalid identifier");
    }
    const ids = b.ids as string[];

    await enforceSubjectBinding(caller, subject, ctx);

    const results = await authorizeMany(subject, action, resourceType, ids, ctx);
    const out = ids.map((id) => {
      const r = results.get(id);
      const result = r ?? { decision: "DENY" as const, reason: "AUTHZ_UNAVAILABLE" as const, retriable: true };
      return { id, decision: result.decision, reason: result.reason, retriable: result.retriable ?? false };
    });

    // Surface PDP outage so callers can distinguish "no access" from "PDP down".
    const degraded = out.some((r) => r.reason === "AUTHZ_UNAVAILABLE");
    return NextResponse.json(
      { results: out, ...(degraded ? { degraded: true, retriable: true } : {}) },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof HttpAuthzError) return metaErrorResponse(err);
    throw err;
  }
}
