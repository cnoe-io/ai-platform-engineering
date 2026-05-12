import { NextRequest } from "next/server";
import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import {
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import { validateTupleKey, withOpenFgaAdminAuth, withOpenFgaViewAuth } from "../_lib";

function limitFromQuery(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : 100;
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 200);
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const params = request.nextUrl.searchParams;
    const tuple: Partial<OpenFgaTupleKey> = {};
    const user = params.get("user")?.trim();
    const relation = params.get("relation")?.trim();
    const object = params.get("object")?.trim();
    if (user) tuple.user = user;
    if (relation) tuple.relation = relation;
    if (object) tuple.object = object;

    const result = await readOpenFgaTuples({
      tuple,
      pageSize: limitFromQuery(request),
      continuationToken: params.get("continuation_token") || undefined,
    });

    return successResponse({
      tuples: result.tuples,
      continuation_token: result.continuationToken,
    });
  })
);

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async () => {
    let body: { writes?: unknown; deletes?: unknown };
    try {
      body = (await request.json()) as { writes?: unknown; deletes?: unknown };
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const writes = Array.isArray(body.writes) ? body.writes.map(validateTupleKey) : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes.map(validateTupleKey) : [];
    if (writes.length === 0 && deletes.length === 0) {
      throw new ApiError("at least one write or delete tuple is required", 400);
    }

    const result = await writeOpenFgaTuples({ writes, deletes });
    return successResponse(result);
  })
);
