import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { isOpenFgaConfigured,isOpenFgaReconciliationEnabled } from "@/lib/rbac/openfga";
import { listRebacCatalog } from "@/lib/rbac/resource-catalog";
import { loadTeamMembersForSlugs } from "@/lib/rbac/team-membership-store";
import type { Team } from "@/types/teams";
import { NextRequest } from "next/server";
import { withOpenFgaViewAuth } from "../_lib";

interface CatalogAgent {
  _id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
}

interface CatalogMcpServer {
  _id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
}

interface TeamKbOwnershipLite {
  kb_ids?: string[];
  kb_permissions?: Record<string, string>;
}

interface CatalogDatasource {
  datasource_id?: string;
  name?: string | null;
  description?: string | null;
}

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL || process.env.NEXT_PUBLIC_RAG_URL || "http://localhost:9446";
}

async function loadDatasourceNames(accessToken?: string): Promise<Map<string, CatalogDatasource>> {
  try {
    const response = await fetch(`${getRagServerUrl()}/v1/datasources`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (!response.ok) return new Map();
    const payload = await response.json();
    const datasources = Array.isArray(payload?.datasources) ? payload.datasources : [];
    return new Map(
      datasources
        .filter((datasource: CatalogDatasource) => typeof datasource.datasource_id === "string")
        .map((datasource: CatalogDatasource) => [datasource.datasource_id as string, datasource])
    );
  } catch {
    return new Map();
  }
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async (auth) => {
    const teamsCol = await getCollection<Team>("teams");
    const agentsCol = await getCollection<CatalogAgent>("dynamic_agents");
    const mcpCol = await getCollection<CatalogMcpServer>("mcp_servers");
    const ownershipCol = await getCollection<TeamKbOwnershipLite>("team_kb_ownership");

    const [teams, agents, servers, ownership] = await Promise.all([
      teamsCol
        .find({} as never, { projection: { _id: 1, name: 1, slug: 1, members: 1 } })
        .sort({ name: 1 })
        .limit(200)
        .toArray()
        .catch(() => [] as Team[]),
      agentsCol
        .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1, description: 1 } })
        .sort({ name: 1 })
        .limit(200)
        .toArray()
        .catch(() => [] as CatalogAgent[]),
      mcpCol
        .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1, description: 1 } })
        .sort({ name: 1 })
        .limit(200)
        .toArray()
        .catch(() => [] as CatalogMcpServer[]),
      ownershipCol.find({}).limit(200).toArray().catch(() => [] as TeamKbOwnershipLite[]),
    ]);

    const kbIds = new Set<string>();
    for (const row of ownership) {
      for (const id of row.kb_ids ?? []) {
        kbIds.add(id);
      }
      for (const id of Object.keys(row.kb_permissions ?? {})) {
        kbIds.add(id);
      }
    }
    const datasourceById = await loadDatasourceNames(auth.session?.accessToken);
    for (const id of datasourceById.keys()) {
      kbIds.add(id);
    }

    const universal = await listRebacCatalog();
    const universalByType = universal.resources.reduce<Record<string, unknown[]>>((acc, resource) => {
      acc[resource.type] = acc[resource.type] ?? [];
      acc[resource.type].push(resource);
      return acc;
    }, {});

    // Member rosters come from the canonical team_membership_sources
    // store (post 2026-05-26 canonical-membership refactor). One bulk
    // query covers every team in the catalog. Each canonical member is
    // shaped back into the legacy { user_id, role } pair so existing
    // catalog consumers don't need to change.
    const teamSlugs = teams
      .map((t) => t.slug)
      .filter((slug): slug is string => typeof slug === "string" && slug.length > 0);
    const membersBySlug = await loadTeamMembersForSlugs(teamSlugs);

    return successResponse({
      status: {
        configured: isOpenFgaConfigured(),
        reconcile_enabled: isOpenFgaReconciliationEnabled(),
        store_name: process.env.OPENFGA_STORE_NAME || "caipe-openfga",
      },
      resource_types: universal.resource_types,
      actions: universal.actions,
      teams: teams.map((team) => {
        const slug = team.slug || String(team._id);
        const canonical = team.slug ? membersBySlug.get(team.slug) ?? [] : [];
        return {
          id: String(team._id),
          slug,
          name: team.name,
          members: canonical.map((member) => ({
            user_id: member.user_email ?? member.user_subject ?? "",
            role: member.role,
          })),
          // Team↔resource grants live in OpenFGA, surfaced via
          // `universal_resources`/`by_type` — not a per-team Mongo array.
        };
      }),
      resources: {
        agents: agents.map((agent) => ({
          id: String(agent._id),
          name: agent.name || String(agent._id),
          description: agent.description || "",
          object: `agent:${String(agent._id)}`,
        })),
        tools: servers.map((server) => ({
          id: `${String(server._id)}_*`,
          name: `${String(server._id)}_*`,
          description: server.description || "",
          object: `tool:${String(server._id)}/*`,
        })),
        knowledge_bases: Array.from(kbIds).sort().map((id) => {
          const datasource = datasourceById.get(id);
          return {
            id,
            name: datasource?.name || id,
            description: datasource?.description || "",
            object: `knowledge_base:${id}`,
          };
        }),
        by_type: universalByType,
      },
      universal_resources: universal.resources,
    });
  })
);
