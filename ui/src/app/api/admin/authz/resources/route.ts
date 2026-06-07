// assisted-by claude code claude-opus-4-8
//
// GET /api/admin/authz/resources?type=<resourceType>
//
// Lists the distinct resource ids of a given type that actually exist in the
// OpenFGA authorization graph (objects that appear in any tuple). This is the
// right source for the Permission Debugger's resource picker: it reflects what
// the PDP can actually decide on — including built-in agents that aren't in the
// dynamic_agents Mongo collection. Admin-gated (admin_ui / audit.view).

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-config";
import { requireRbacPermission, withErrorHandler, ApiError } from "@/lib/api-middleware";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";
import { getCollection } from "@/lib/mongodb";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";
import { webexSpaceSubjectId } from "@/lib/rbac/webex-space-grant-store";

const RESOURCE_TYPES = new Set([
  "agent", "skill", "mcp_tool", "knowledge_base", "data_source",
  "task", "slack_channel", "webex_space", "organization", "team", "conversation",
]);

// OpenFGA Read rejects a bare `object: "type:"` filter (it requires an object
// id or a user). So we page through the whole tuple set and filter by type
// prefix in code — bounded by MAX_PAGES for safety on large stores.
const MAX_PAGES = 25;
const PAGE_SIZE = 100;
const LABEL_LOOKUP_LIMIT = 2000;

/**
 * Map opaque OpenFGA ids to human-readable names where a source of truth
 * exists: slack/webex channels (mapping collections) and workflows (the
 * `task` type → workflow_configs). Best-effort: falls back to the id.
 */
async function buildLabelMap(type: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    if (type === "slack_channel") {
      const coll = await getCollection<{ slack_workspace_id?: string; slack_channel_id?: string; channel_name?: string }>("channel_team_mappings");
      const rows = await coll.find({}).limit(LABEL_LOOKUP_LIMIT).toArray();
      for (const r of rows) {
        if (!r.slack_channel_id || !r.channel_name) continue;
        map.set(slackChannelSubjectId(r.slack_workspace_id ?? "", r.slack_channel_id), r.channel_name);
      }
    } else if (type === "webex_space") {
      const coll = await getCollection<{ webex_workspace_id?: string; webex_space_id?: string; space_name?: string; space_title?: string }>("webex_space_team_mappings");
      const rows = await coll.find({}).limit(LABEL_LOOKUP_LIMIT).toArray();
      for (const r of rows) {
        if (!r.webex_space_id) continue;
        const name = r.space_name ?? r.space_title;
        if (name) map.set(webexSpaceSubjectId(r.webex_workspace_id ?? "", r.webex_space_id), name);
      }
    } else if (type === "task") {
      // Workflows are graphed as `task` — surface the workflow's display name.
      const coll = await getCollection<{ _id: unknown; name?: string }>("workflow_configs");
      const rows = await coll.find({}).limit(LABEL_LOOKUP_LIMIT).toArray();
      for (const r of rows) {
        const id = typeof r._id === "string" ? r._id : String(r._id);
        if (id && r.name) map.set(id, r.name);
      }
    }
  } catch {
    // best-effort — ids remain usable as labels
  }
  return map;
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
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

  const type = new URL(request.url).searchParams.get("type")?.trim();
  if (!type || !RESOURCE_TYPES.has(type)) {
    throw new ApiError(`\`type\` must be one of: ${[...RESOURCE_TYPES].join(", ")}`, 400, "VALIDATION_ERROR");
  }

  const prefix = `${type}:`;
  const ids = new Set<string>();
  let continuationToken: string | undefined;
  let pages = 0;

  try {
    do {
      const { tuples, continuationToken: next } = await readOpenFgaTuples({
        pageSize: PAGE_SIZE,
        continuationToken,
      });
      for (const t of tuples) {
        const object = t.key?.object ?? "";
        if (!object.startsWith(prefix)) continue;
        const id = object.slice(prefix.length);
        // Skip wildcards (`*`) and usersets (`team:x#member`); they aren't pickable resources.
        if (id && id !== "*" && !id.includes("#")) ids.add(id);
      }
      continuationToken = next;
      pages += 1;
    } while (continuationToken && pages < MAX_PAGES);
  } catch (err) {
    // The debugger degrades to a text field if the catalog can't be read.
    console.warn("[authz/resources] read failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ resources: [], error: "catalog_unavailable" }, { headers: { "Cache-Control": "no-store" } });
  }

  const labels = await buildLabelMap(type);
  const resources = [...ids].sort().map((id) => ({ id, label: labels.get(id) ?? id }));
  return NextResponse.json({ resources }, { headers: { "Cache-Control": "no-store" } });
});
