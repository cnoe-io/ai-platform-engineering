import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import {
readOpenFgaTuples,
writeOpenFgaTuples,
type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import { NextRequest } from "next/server";
import { ALLOWED_RELATIONS,validateTupleKey,withOpenFgaAdminAuth,withOpenFgaViewAuth } from "../_lib";

function limitFromQuery(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : 100;
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 200);
}

function matchesFilter(value: string, filter: string | undefined): boolean {
  if (!filter) return true;
  return value.toLowerCase().includes(filter.toLowerCase());
}

const EXACT_TUPLE_FIELD = /^[A-Za-z0-9._:@#*+=,/-]+$/;

function exactTupleField(value: string | undefined): string | undefined {
  if (!value || !EXACT_TUPLE_FIELD.test(value)) return undefined;
  if (!value.includes(":") || value.endsWith(":")) return undefined;
  return value;
}

function exactRelationFilter(value: string | undefined): string | undefined {
  if (!value || !EXACT_TUPLE_FIELD.test(value)) return undefined;
  return ALLOWED_RELATIONS.has(value) ? value : undefined;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async ({ user: actor, session }) => {
    const params = request.nextUrl.searchParams;
    const user = params.get("user")?.trim();
    const relation = params.get("relation")?.trim();
    const object = params.get("object")?.trim();
    const tuple: Partial<OpenFgaTupleKey> = {
      ...(exactTupleField(user) ? { user: exactTupleField(user) } : {}),
      ...(exactRelationFilter(relation) ? { relation: exactRelationFilter(relation) } : {}),
      ...(exactTupleField(object) ? { object: exactTupleField(object) } : {}),
    };
    const openFgaTuple = tuple.object ? tuple : undefined;

    const result = await readOpenFgaTuples({
      ...(openFgaTuple ? { tuple: openFgaTuple } : {}),
      pageSize: limitFromQuery(request),
      continuationToken: params.get("continuation_token") || undefined,
    });
    const tuples = result.tuples.filter(
      (entry) =>
        matchesFilter(entry.key.user, user) &&
        matchesFilter(entry.key.relation, relation) &&
        matchesFilter(entry.key.object, object),
    );

    logOpenFgaRebacAuditEvent({
      tenantId: session?.org ?? "default",
      sub: session?.sub ?? actor.email,
      operation: "list_tuples",
      resourceRef: `openfga_tuples:${JSON.stringify({ tuple, limit: limitFromQuery(request) })}`,
      email: actor.email,
    });

    return successResponse({
      tuples,
      continuation_token: result.continuationToken,
    });
  })
);

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async ({ user, session }) => {
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
    logOpenFgaRebacAuditEvent({
      tenantId: session?.org ?? "default",
      sub: session?.sub ?? user.email,
      operation: "write_tuples",
      scope: "admin",
      resourceRef: `openfga_tuples:${JSON.stringify({
        requested_writes: writes.length,
        requested_deletes: deletes.length,
        applied_writes: result.writes,
        applied_deletes: result.deletes,
      })}`,
      email: user.email,
    });
    return successResponse(result);
  })
);
