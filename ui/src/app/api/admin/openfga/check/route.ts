import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { NextRequest } from "next/server";
import { validateTupleKey,withOpenFgaViewAuth } from "../_lib";

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async ({ user, session }) => {
    let body: { tuple?: unknown };
    try {
      body = (await request.json()) as { tuple?: unknown };
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const tuple = validateTupleKey(body.tuple);
    const result = await checkOpenFgaTuple(tuple);
    logOpenFgaRebacAuditEvent({
      tenantId: session?.org ?? "default",
      sub: session?.sub ?? user.email,
      operation: "tuple_check",
      outcome: result.allowed ? "allow" : "deny",
      reasonCode: result.allowed ? "OK" : "DENY_NO_CAPABILITY",
      resourceRef: `${tuple.user} ${tuple.relation} ${tuple.object}`,
      email: user.email,
    });
    return successResponse({ tuple, ...result });
  })
);
