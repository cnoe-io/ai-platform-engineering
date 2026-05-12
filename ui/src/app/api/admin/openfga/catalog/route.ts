import { NextRequest } from "next/server";
import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { isOpenFgaConfigured, isOpenFgaReconciliationEnabled } from "@/lib/rbac/openfga";
import type { Team } from "@/types/teams";
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

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const teamsCol = await getCollection<Team>("teams");
    const agentsCol = await getCollection<CatalogAgent>("dynamic_agents");
    const mcpCol = await getCollection<CatalogMcpServer>("mcp_servers");
    const ownershipCol = await getCollection<TeamKbOwnershipLite>("team_kb_ownership");

    const [teams, agents, servers, ownership] = await Promise.all([
      teamsCol
        .find({} as never, { projection: { _id: 1, name: 1, slug: 1, members: 1, resources: 1 } })
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

    return successResponse({
      status: {
        configured: isOpenFgaConfigured(),
        reconcile_enabled: isOpenFgaReconciliationEnabled(),
        store_name: process.env.OPENFGA_STORE_NAME || "caipe-openfga",
      },
      teams: teams.map((team) => ({
        id: String(team._id),
        slug: team.slug || String(team._id),
        name: team.name,
        members: (team.members ?? []).map((member) => ({
          user_id: member.user_id,
          role: member.role,
        })),
        resources: team.resources ?? {},
      })),
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
          object: `tool:${String(server._id)}_*`,
        })),
        knowledge_bases: Array.from(kbIds).sort().map((id) => ({
          id,
          name: id,
          description: "",
          object: `knowledge_base:${id}`,
        })),
      },
    });
  })
);
