// assisted-by claude code claude-opus-4-8
//
// POST /api/admin/authz/explain — admin permission debugger.
//
// "Why can/can't subject S do action A on resource R?" Returns the CAS
// decision plus the OpenFGA debug block (the relation actually checked).
// Admin-gated (admin_ui / audit.view); no subject-binding because this is a
// privileged forensic tool, not a self-service decision call.
//
// Single action  → { decision, reason, retriable, debug }            (back-compat)
// `actions: [..]` (or neither field) → { results: [ {action, decision, reason, retriable, debug} ] }
//   — the permission-matrix view: every action for one subject+resource at once.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-config";
import { requireRbacPermission, withErrorHandler, ApiError } from "@/lib/api-middleware";
import { authorize, describeFgaCheck, type Action, type Resource, type Subject } from "@/lib/authz";
import { HttpAuthzError, parseAction, parseResource, parseSubject } from "@/lib/authz/http";

const ALL_ACTIONS: Action[] = [
  "discover", "read", "read-metadata", "use", "write", "create",
  "manage", "share", "delete", "ingest", "call", "invoke", "audit",
];

function explainOne(subject: Subject, resource: Resource, action: Action, tenantId?: string) {
  return (async () => {
    const req = { subject, resource, action };
    const result = await authorize(req, { tenantId });
    const fga = describeFgaCheck(req);
    return {
      action,
      decision: result.decision,
      reason: result.reason,
      retriable: result.retriable,
      via: result.via ?? null,
      debug: {
        engine: fga.engine,
        relation: fga.relation,
        checked: [`${fga.user} ${fga.relation} ${fga.object}`],
        store: fga.store,
      },
    };
  })();
}

export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    sub?: string;
    org?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    throw new ApiError("Unauthorized", 401);
  }

  await requireRbacPermission(
    {
      accessToken: session.accessToken,
      sub: session.sub,
      org: session.org,
      user: { email: session.user.email ?? undefined },
    },
    "admin_ui",
    "audit.view",
  );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("Request body must be valid JSON", 400, "VALIDATION_ERROR");
  }
  if (!body || typeof body !== "object") {
    throw new ApiError("Request body must be an object", 400, "VALIDATION_ERROR");
  }
  const b = body as Record<string, unknown>;

  let subject: Subject;
  let resource: Resource;
  let singleAction: Action | null = null;
  let actions: Action[];
  try {
    subject = parseSubject(b.subject);
    resource = parseResource(b.resource);
    if (Array.isArray(b.actions)) {
      // Matrix mode: validate each requested action (empty → all).
      actions = (b.actions.length > 0 ? b.actions : ALL_ACTIONS).map(parseAction);
    } else if (b.action != null) {
      singleAction = parseAction(b.action);
      actions = [singleAction];
    } else {
      // Neither field → evaluate the full matrix.
      actions = ALL_ACTIONS;
    }
  } catch (err) {
    if (err instanceof HttpAuthzError) {
      throw new ApiError(err.message, err.status, err.code);
    }
    throw err;
  }

  const results = await Promise.all(actions.map((a) => explainOne(subject, resource, a, session.org)));

  // Back-compat: a single `action` returns the flat shape; everything else
  // (matrix) returns { results: [...] }.
  const payload = singleAction !== null ? results[0] : { results };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
});
