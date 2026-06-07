// assisted-by claude code claude-opus-4-8
//
// POST /api/admin/authz/explain — admin permission debugger.
//
// "Why can/can't subject S do action A on resource R?" Returns the CAS
// decision plus the OpenFGA debug block (the relation actually checked).
// Admin-gated (admin_ui / audit.view); no subject-binding because this is a
// privileged forensic tool, not a self-service decision call.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-config";
import { requireRbacPermission, withErrorHandler, ApiError } from "@/lib/api-middleware";
import { authorize, describeFgaCheck } from "@/lib/authz";
import { HttpAuthzError, parseAction, parseResource, parseSubject } from "@/lib/authz/http";

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

  let req;
  try {
    req = {
      subject: parseSubject(b.subject),
      resource: parseResource(b.resource),
      action: parseAction(b.action),
    };
  } catch (err) {
    if (err instanceof HttpAuthzError) {
      throw new ApiError(err.message, err.status, err.code);
    }
    throw err;
  }

  const result = await authorize(req, { tenantId: session.org });
  const fga = describeFgaCheck(req);

  return NextResponse.json(
    {
      decision: result.decision,
      reason: result.reason,
      retriable: result.retriable,
      debug: {
        engine: fga.engine,
        relation: fga.relation,
        checked: [`${fga.user} ${fga.relation} ${fga.object}`],
        store: fga.store,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
