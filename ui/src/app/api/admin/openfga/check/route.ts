import { NextRequest } from "next/server";
import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { validateTupleKey, withOpenFgaViewAuth } from "../_lib";

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    let body: { tuple?: unknown };
    try {
      body = (await request.json()) as { tuple?: unknown };
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const tuple = validateTupleKey(body.tuple);
    const result = await checkOpenFgaTuple(tuple);
    return successResponse({ tuple, ...result });
  })
);
