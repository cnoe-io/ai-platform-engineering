import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { adoptConfigImportedAgents,loadSeedConfig } from "@/lib/seed-config";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";
import type { Team } from "@/types/teams";

interface SyncPreviewAgent {
  id: string;
  name: string;
  description?: string;
  /** Whether this agent id is present with config_driven=true in Mongo today. */
  in_db: boolean;
  /** Already adopted by a prior import run — excluded from the apply batch. */
  already_adopted: boolean;
}

interface SyncFromConfigResult {
  agents: SyncPreviewAgent[];
  adopted?: string[];
  skipped?: string[];
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * List agents currently defined in the YAML seed file (APP_CONFIG_PATH),
 * annotated with their present Mongo state, for the import preview.
 */
async function previewAgentsFromConfig(): Promise<SyncPreviewAgent[]> {
  const configPath = process.env.APP_CONFIG_PATH;
  if (!configPath) return [];

  const { agents } = loadSeedConfig(configPath);
  const ids = agents.map((a) => a.id as string | undefined).filter(Boolean) as string[];
  if (ids.length === 0) return [];

  const collection = await getCollection<DynamicAgentConfig>("dynamic_agents");
  const existingDocs = await collection
    .find({ _id: { $in: ids } })
    .project({ _id: 1, config_driven: 1, config_import_adopted: 1 })
    .toArray();
  const byId = new Map(existingDocs.map((doc) => [doc._id, doc]));

  const previews: SyncPreviewAgent[] = [];
  for (const agentData of agents) {
    const id = agentData.id as string | undefined;
    if (!id) continue;
    const existing = byId.get(id);
    previews.push({
      id,
      name: (agentData.name as string) ?? id,
      description: (agentData.description as string) ?? undefined,
      in_db: Boolean(existing),
      already_adopted: existing?.config_import_adopted === true,
    });
  }
  return previews;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun = body.dry_run !== false;

  const previewAgents = await previewAgentsFromConfig();

  if (dryRun) {
    return successResponse<SyncFromConfigResult>({ agents: previewAgents });
  }

  const requestedIds = Array.isArray(body.agent_ids)
    ? body.agent_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : previewAgents.filter((a) => a.in_db && !a.already_adopted).map((a) => a.id);

  const ownerTeamSlug = normalizeString(body.owner_team_slug);
  const sharedTeamSlugs = Array.isArray(body.shared_with_teams)
    ? body.shared_with_teams.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  if (ownerTeamSlug) {
    const teams = await getCollection<Team>("teams");
    const team = await teams.findOne({ slug: ownerTeamSlug } as never);
    if (!team) {
      throw new ApiError(`Owning team "${ownerTeamSlug}" not found`, 404, "OWNER_TEAM_NOT_FOUND");
    }
  }

  const { adopted, skipped } = await adoptConfigImportedAgents(requestedIds, {
    ownerTeamSlug,
    sharedTeamSlugs,
  });

  return successResponse<SyncFromConfigResult>({ agents: previewAgents, adopted, skipped });
});
