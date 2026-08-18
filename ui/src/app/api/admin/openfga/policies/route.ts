import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import {
  deleteExpressionPolicy,
  listExpressionPolicies,
  putExpressionPolicy,
  type ExpressionPolicyInput,
} from "@/lib/authz/policy-client";
import { NextRequest } from "next/server";

import { withOpenFgaAdminAuth, withOpenFgaViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => successResponse(await listExpressionPolicies(
    request.nextUrl.searchParams.get("resource_type") ?? undefined,
    request.nextUrl.searchParams.get("resource_id") ?? undefined,
  )))
);

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async () => {
    const body = await request.json().catch(() => { throw new ApiError("Invalid JSON body", 400); }) as
      ExpressionPolicyInput & { policy_id?: string; version?: number };
    if (!body.policy_id || !Number.isInteger(body.version)) throw new ApiError("policy_id and version are required", 400);
    const { policy_id: policyId, version, ...input } = body;
    return successResponse(await putExpressionPolicy(policyId, version as number, input));
  })
);

export const DELETE = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async () => {
    const policyId = request.nextUrl.searchParams.get("policy_id")?.trim();
    const version = Number(request.nextUrl.searchParams.get("version"));
    if (!policyId || !Number.isInteger(version)) throw new ApiError("policy_id and integer version are required", 400);
    return successResponse(await deleteExpressionPolicy(policyId, version));
  })
);
