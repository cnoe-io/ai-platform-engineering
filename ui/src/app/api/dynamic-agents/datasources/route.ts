/**
 * API route for listing the datasources a team can see, for the dynamic
 * agent editor's datasource-binding picker (spec
 * 2026-07-21-rag-source-mgmt-ui, Workstream D).
 *
 * GET /api/dynamic-agents/datasources?team_slug=<slug>
 *
 * Returns the team's `knowledge_base` grants (OpenFGA — the same source
 * `listTeamKbGrants` feeds the KB-assignments admin panel from), joined
 * with display names from the RAG server's `/v1/datasources` so the picker
 * can show a label instead of a raw id. The agent's `datasource_ids` is a
 * NARROWING config on top of this list — the runtime intersects it with
 * whatever the caller can see, so this endpoint only needs to answer "what
 * can the owning team see," not "what can this specific caller see."
 */

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { listTeamKbGrants } from "@/lib/rbac/team-resource-listing";
import { NextRequest } from "next/server";

function getRagServerUrl(): string {
  return (
    process.env.RAG_SERVER_URL ||
    process.env.NEXT_PUBLIC_RAG_URL ||
    "http://localhost:9446"
  );
}

interface RagDatasourceListItem {
  datasource_id?: unknown;
  id?: unknown;
  name?: unknown;
}

/**
 * Best-effort id -> display name lookup from the RAG server. Returns an
 * empty map (never throws) so a RAG-server outage degrades the picker to
 * raw ids instead of failing the whole editor load.
 */
async function loadDatasourceNames(
  ids: string[],
  session: { accessToken?: string; org?: string },
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0 || !session.accessToken) return names;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
  if (session.org) headers["X-Tenant-Id"] = session.org;

  try {
    const response = await fetch(`${getRagServerUrl()}/v1/datasources`, {
      method: "GET",
      headers,
    });
    if (!response.ok) return names;
    const data: unknown = await response.json();
    const list =
      data &&
      typeof data === "object" &&
      Array.isArray((data as { datasources?: unknown }).datasources)
        ? (data as { datasources: RagDatasourceListItem[] }).datasources
        : [];
    for (const item of list) {
      const id = item.datasource_id ?? item.id;
      if (typeof id !== "string" || !id) continue;
      if (typeof item.name === "string" && item.name.trim()) {
        names.set(id, item.name.trim());
      }
    }
  } catch {
    // best-effort — fall back to raw ids
  }
  return names;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

  const { searchParams } = new URL(request.url);
  const teamSlug = (searchParams.get("team_slug") || "").trim();
  if (!teamSlug) {
    return successResponse({ datasources: [] });
  }

  // The caller must be able to act as this team (member/admin) — mirrors the
  // owner-team gate used elsewhere in the agent editor's write path.
  try {
    await requireResourcePermission(session, { type: "team", id: teamSlug, action: "use" });
  } catch {
    await requireResourcePermission(session, { type: "team", id: teamSlug, action: "manage" });
  }

  const grants = await listTeamKbGrants(teamSlug);
  const names = await loadDatasourceNames(grants.kbIds, {
    accessToken: session.accessToken,
    org: session.org,
  });

  return successResponse({
    datasources: grants.kbIds
      .map((id) => ({
        datasource_id: id,
        name: names.get(id) || id,
        permission: grants.permissions[id],
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});
