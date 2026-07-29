/**
 * `POST /api/admin/rag/sources/migrate-from-config` — admin action to adopt
 * Helm-seeded (`config_driven: true`) RAG ingestion sources into the DB as
 * permanent, team-owned records (spec 2026-07-21-rag-source-config-db, US5).
 *
 * Mirrors `../../dynamic-agents/runtime/sync-from-config/route.ts` exactly:
 * same `admin_ui#admin` gate, same `dry_run` preview/apply split. The
 * preview derives each YAML `rag_sources` entry's deterministic `source_id`
 * (there's no explicit id in config, unlike agents) and cross-references it
 * against Mongo so the admin sees `in_db`/`already_adopted` before applying.
 */

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { computeIngestionSourceId } from "@/lib/ingestion-source-id";
import { getCollection } from "@/lib/mongodb";
import {
  adoptConfigImportedRagSources,
  extractRagSourceTypeFields,
  loadSeedConfig,
  type RagSourceAdoptSkip,
} from "@/lib/seed-config";
import type { IngestionSourceConfig } from "@/types/ingestion-source";
import type { Team } from "@/types/teams";

interface MigratePreviewSource {
  source_id: string;
  name: string;
  source_type: string;
  /** Whether this source_id is present with config_driven=true in Mongo today. */
  in_db: boolean;
  /** Already adopted by a prior migration run — excluded from the apply batch. */
  already_adopted: boolean;
}

interface MigrateFromConfigResult {
  sources: MigratePreviewSource[];
  adopted?: string[];
  skipped?: RagSourceAdoptSkip[];
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * List RAG ingestion sources currently defined in the YAML seed file
 * (APP_CONFIG_PATH), annotated with their present Mongo state, for the
 * import preview.
 */
async function previewSourcesFromConfig(): Promise<MigratePreviewSource[]> {
  const configPath = process.env.APP_CONFIG_PATH;
  if (!configPath) return [];

  const { rag_sources } = loadSeedConfig(configPath);
  if (rag_sources.length === 0) return [];

  const entries: Array<{ sourceId: string; name: string; sourceType: string }> = [];
  for (const sourceData of rag_sources) {
    const extracted = extractRagSourceTypeFields(sourceData);
    if (!extracted) continue;
    entries.push({
      sourceId: computeIngestionSourceId(extracted.identity),
      name: (sourceData.name as string) ?? computeIngestionSourceId(extracted.identity),
      sourceType: extracted.identity.source_type,
    });
  }
  if (entries.length === 0) return [];

  const collection = await getCollection<IngestionSourceConfig>("rag_ingestion_sources");
  const existingDocs = await collection
    .find({ source_id: { $in: entries.map((e) => e.sourceId) } } as never)
    .project({ source_id: 1, config_driven: 1, config_import_adopted: 1 })
    .toArray();
  const byId = new Map(existingDocs.map((doc) => [doc.source_id, doc]));

  return entries.map((entry) => {
    const existing = byId.get(entry.sourceId);
    return {
      source_id: entry.sourceId,
      name: entry.name,
      source_type: entry.sourceType,
      in_db: Boolean(existing),
      already_adopted: existing?.config_import_adopted === true,
    };
  });
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun = body.dry_run !== false;

  const previewSources = await previewSourcesFromConfig();

  if (dryRun) {
    return successResponse<MigrateFromConfigResult>({ sources: previewSources });
  }

  const requestedIds = Array.isArray(body.source_ids)
    ? body.source_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : previewSources.filter((s) => s.in_db && !s.already_adopted).map((s) => s.source_id);

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

  const { adopted, skipped } = await adoptConfigImportedRagSources(requestedIds, {
    ownerTeamSlug,
    sharedTeamSlugs,
  });

  return successResponse<MigrateFromConfigResult>({ sources: previewSources, adopted, skipped });
});
