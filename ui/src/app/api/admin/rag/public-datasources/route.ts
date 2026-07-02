/**
 * Public datasources admin route.
 *
 * Marks a RAG datasource readable by **every authenticated user** by
 * writing the OpenFGA typed-wildcard tuple `user:* reader` on both the
 * `knowledge_base:<id>` and `data_source:<id>` objects.
 *
 * Why both types: discovery/listing surfaces read `knowledge_base#can_read`
 * while query-time enforcement (RAG server `inject_kb_filter` + the BFF
 * `data_source#read` filter) reads `data_source#can_read`. A wildcard on
 * only one type would either show-but-not-search or search-but-not-show.
 *
 * This is the intended mechanism for the pre-RBAC ("public") datasources
 * that should remain broadly readable after team-scope enforcement is on,
 * without maintaining an everyone-team membership roster.
 *
 * The `user:*` wildcard is permitted on `*.reader` by the CAIPE OpenFGA
 * model (see deploy/openfga/model.fga). Writes go through
 * `writeOpenFgaTupleDiff` directly rather than the universal
 * `/relationship` route, because `data_source` is intentionally not a
 * universal-catalog resource type (it has no UI picker) and would be
 * rejected by that route's validator.
 *
 * GET  ?datasource_id=<id> → { datasource_id, public: boolean }
 * POST { datasource_id, public: boolean } → grants/revokes the wildcard
 *
 * Gate: `admin_ui#admin` (org/platform admins only). Making a datasource
 * world-readable is a privileged action and is intentionally NOT delegated
 * to team admins.
 */

import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import {
readOpenFgaTuples,
writeOpenFgaTupleDiff,
type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import { NextRequest } from "next/server";
import { withOpenFgaAdminAuth,withOpenFgaViewAuth } from "../../openfga/_lib";

// Same id charset the other RAG/OpenFGA routes accept.
const DATASOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

const PUBLIC_SUBJECT = "user:*";
const READER_RELATION = "reader";

function publicTuples(datasourceId: string): OpenFgaTupleKey[] {
  return [
    { user: PUBLIC_SUBJECT, relation: READER_RELATION, object: `knowledge_base:${datasourceId}` },
    { user: PUBLIC_SUBJECT, relation: READER_RELATION, object: `data_source:${datasourceId}` },
  ];
}

function parseDatasourceId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || !DATASOURCE_ID_PATTERN.test(id)) {
    throw new ApiError("A valid datasource_id is required", 400, "INVALID_DATASOURCE_ID");
  }
  return id;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const datasourceId = parseDatasourceId(request.nextUrl.searchParams.get("datasource_id"));
    // Public iff the data_source wildcard reader tuple exists — that's the
    // one the query path actually enforces on.
    const page = await readOpenFgaTuples({
      tuple: { user: PUBLIC_SUBJECT, relation: READER_RELATION, object: `data_source:${datasourceId}` },
      pageSize: 1,
    });
    const isPublic = (page.tuples ?? []).some(
      (tuple) =>
        tuple.key?.user === PUBLIC_SUBJECT &&
        tuple.key?.relation === READER_RELATION &&
        tuple.key?.object === `data_source:${datasourceId}`,
    );
    return successResponse({ datasource_id: datasourceId, public: isPublic });
  }),
);

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async ({ user, session }) => {
    let body: { datasource_id?: unknown; public?: unknown };
    try {
      body = (await request.json()) as { datasource_id?: unknown; public?: unknown };
    } catch {
      throw new ApiError("Invalid JSON body", 400, "INVALID_JSON");
    }
    const datasourceId = parseDatasourceId(body.datasource_id);
    if (typeof body.public !== "boolean") {
      throw new ApiError("`public` must be a boolean", 400, "INVALID_PUBLIC_FLAG");
    }

    const tuples = publicTuples(datasourceId);
    const diff = body.public
      ? { writes: tuples, deletes: [] }
      : { writes: [], deletes: tuples };
    const result = await writeOpenFgaTupleDiff(diff);
    if (!result.enabled) {
      throw new ApiError(
        "OpenFGA reconciliation is not enabled; public datasource state cannot be persisted",
        503,
        "OPENFGA_DISABLED",
      );
    }

    logOpenFgaRebacAuditEvent({
      tenantId: session?.org ?? "default",
      sub: session?.sub ?? user.email,
      operation: body.public ? "grant_public_datasource" : "revoke_public_datasource",
      scope: "admin",
      resourceRef: `data_source:${datasourceId}`,
      email: user.email,
    });

    return successResponse({ datasource_id: datasourceId, public: body.public, result });
  }),
);
