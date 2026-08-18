import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { validateExpressionPolicy, type ExpressionPolicyInput } from "@/lib/authz/policy-client";
import { NextRequest } from "next/server";

import { withOpenFgaAdminAuth } from "../../_lib";

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async () => {
    const body = await request.json() as ExpressionPolicyInput & { version?: number };
    delete body.version;
    return successResponse(await validateExpressionPolicy(body as ExpressionPolicyInput));
  })
);
