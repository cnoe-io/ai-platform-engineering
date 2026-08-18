import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { putPolicySchema } from "@/lib/authz/policy-client";
import { getCollection } from "@/lib/mongodb";
import {
  MCP_TOOL_CATALOG_COLLECTION,
  type McpToolCatalogEntry,
} from "@/lib/rbac/mcp-tool-catalog";
import { NextRequest } from "next/server";

import { withOpenFgaAdminAuth, withOpenFgaViewAuth } from "../../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const rows = await (await getCollection<McpToolCatalogEntry>(MCP_TOOL_CATALOG_COLLECTION))
      .find(
        { enabled: true, kind: "tool", input_schema_hash: { $exists: true } } as never,
        { projection: { _id: 1, display_name: 1, input_schema_hash: 1, eligible_policy_fields: 1 } },
      )
      .sort({ display_name: 1 })
      .limit(500)
      .toArray();
    return successResponse({ tools: rows.map((row) => ({
      ref: row._id,
      name: row.display_name,
      schema_hash: row.input_schema_hash,
      eligible_fields: row.eligible_policy_fields ?? [],
    })) });
  })
);

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async () => {
    const body = await request.json().catch(() => { throw new ApiError("Invalid JSON body", 400); }) as { ref?: string };
    const ref = body.ref?.trim();
    if (!ref) throw new ApiError("tool ref is required", 400);
    const row = await (await getCollection<McpToolCatalogEntry>(MCP_TOOL_CATALOG_COLLECTION)).findOne({ _id: ref });
    if (!row?.input_schema_hash || !row.input_schema || !row.eligible_policy_fields) {
      throw new ApiError("tool has no eligible sanitized policy schema", 409);
    }
    return successResponse(await putPolicySchema({
      resource_type: "tool",
      resource_id: ref,
      schema_hash: row.input_schema_hash,
      schema: row.input_schema,
      eligible_fields: row.eligible_policy_fields,
    }));
  })
);
