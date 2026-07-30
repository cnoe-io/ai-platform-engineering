/**
 * `POST /api/admin/rag/sources/migrate-from-config` — admin action to adopt
 * already-ingested RAG datasources into the DB as permanent, delegable
 * config rows (spec 2026-07-21-rag-source-config-db, US5 / rag-source-mgmt-ui
 * migrate workstream).
 *
 * The BFF cannot read ingestor-pod env vars (spec FR-007 blocker), so
 * "migrate" means "adopt what has already ingested" rather than "import
 * declared-but-not-yet-ingested YAML config": the preview enumerates the
 * Redis `DataSourceInfo` records the BFF already reads via the RAG server's
 * `GET /v1/datasources` (same fetch pattern as `loadOwnerFromConfig` in
 * `kbs/[id]/sharing/route.ts`), and cross-references each `datasource_id`
 * against `rag_ingestion_sources`. A row is importable when a
 * `DataSourceInfo` exists but there is no config row yet.
 *
 * Apply reuses `createIngestionSource` (the same insert + triple-OpenFGA-
 * reconcile helper `POST /api/rag/sources` uses) so an adopted source gets
 * both the `ingestion_source` management grant and the `knowledge_base`/
 * `data_source` query-visibility grants. Ownership defaults to null (no
 * owner team, no shared teams): with query-time RBAC on, that resolves to
 * superadmin-only access until a team is delegated via the sharing dialog.
 */

import { NextRequest } from "next/server";

import { createIngestionSource } from "@/app/api/rag/sources/route";
import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import type { IngestionSourceConfig, IngestionSourceType } from "@/types/ingestion-source";
import type { Team } from "@/types/teams";

interface MigratePreviewSource {
  source_id: string;
  name: string;
  source_type: string;
  /** A config row for this source_id already exists in Mongo. */
  in_db: boolean;
  /** Already adopted by a prior migration run — excluded from the apply batch. */
  already_adopted: boolean;
}

type MigrateSkipReason = "not_found_in_redis" | "missing_identity_fields" | "already_in_db";

interface MigrateSkip {
  source_id: string;
  reason: MigrateSkipReason;
}

interface MigrateFromConfigResult {
  sources: MigratePreviewSource[];
  adopted?: string[];
  skipped?: MigrateSkip[];
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRagServerUrl(): string {
  return (
    process.env.RAG_SERVER_URL ||
    process.env.NEXT_PUBLIC_RAG_URL ||
    "http://localhost:9446"
  );
}

/**
 * Redis' short `source_type` values → this store's long discriminant.
 * Anything absent (e.g. `argocdv3`, `aws`, `backstage`, `github`,
 * `kubernetes`, `s3`, `dummy_structured_entities`) is not a self-service
 * ingestion source and is excluded from the preview entirely.
 */
const SOURCE_TYPE_MAP: Record<string, IngestionSourceType> = {
  slack: "slack_channel",
  confluence: "confluence_space",
  jira: "jira_project",
  web: "web_url",
  webex: "webex_space",
};

interface RedisDataSource {
  datasource_id: string;
  name?: string;
  source_type: string;
  metadata?: Record<string, unknown> | null;
  reload_interval?: number;
  default_chunk_size?: number;
  default_chunk_overlap?: number;
}

async function fetchRedisDatasources(session: {
  accessToken?: string;
  org?: string;
}): Promise<RedisDataSource[]> {
  if (!session.accessToken) return [];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
  if (session.org) headers["X-Tenant-Id"] = session.org;

  let response: Response;
  try {
    response = await fetch(`${getRagServerUrl()}/v1/datasources`, { method: "GET", headers });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return [];
  }
  return data &&
    typeof data === "object" &&
    Array.isArray((data as { datasources?: unknown }).datasources)
    ? (data as { datasources: RedisDataSource[] }).datasources
    : [];
}

/**
 * Recover this store's type-specific identity fields from a Redis
 * `DataSourceInfo`'s `metadata`. Returns `null` when a required field is
 * absent, so the caller can skip the row the same way `extractSourceIdentity`
 * (`ui/src/app/api/rag/sources/route.ts`) skips malformed create payloads.
 *
 * Jira has no independent slug field in `metadata` — the ingestor derives
 * `datasource_id` as `jira-{project_key.lower()}-{slugify(name)}`, so
 * `source_slug` is recovered by stripping that known prefix rather than
 * re-deriving it from the (possibly since-renamed) `name`. Every other type
 * reuses `ds.datasource_id` verbatim as `source_id` rather than recomputing
 * it via `computeIngestionSourceId`, so the adopted row keeps the exact id
 * already used in Milvus/Redis regardless of any TS/Python id-formula drift.
 */
function extractFieldsFromRedis(
  ds: RedisDataSource,
  sourceType: IngestionSourceType,
): Record<string, unknown> | null {
  const meta = ds.metadata ?? {};

  switch (sourceType) {
    case "slack_channel": {
      const channelId = normalizeString(meta.channel_id);
      if (!channelId) return null;
      return {
        source_type: sourceType,
        channel_id: channelId,
        lookback_days: meta.lookback_days as number | undefined,
      };
    }
    case "confluence_space": {
      const confluenceUrl = normalizeString(meta.confluence_url);
      const spaceKey = normalizeString(meta.space_key);
      if (!confluenceUrl || !spaceKey) return null;
      return { source_type: sourceType, confluence_url: confluenceUrl, space_key: spaceKey };
    }
    case "jira_project": {
      const projectKey = normalizeString(meta.project_key);
      if (!projectKey) return null;
      const prefix = `jira-${projectKey.toLowerCase()}-`;
      if (!ds.datasource_id.startsWith(prefix)) return null;
      const sourceSlug = ds.datasource_id.slice(prefix.length);
      if (!sourceSlug) return null;
      return {
        source_type: sourceType,
        project_key: projectKey,
        source_slug: sourceSlug,
        jql: normalizeString(meta.jql) ?? "",
      };
    }
    case "web_url": {
      const urlIngestRequest = meta.url_ingest_request as Record<string, unknown> | undefined;
      const url = normalizeString(urlIngestRequest?.url);
      if (!url) return null;
      return { source_type: sourceType, url };
    }
    case "webex_space": {
      const spaceId = normalizeString(meta.space_id);
      if (!spaceId) return null;
      return { source_type: sourceType, space_id: spaceId };
    }
  }
}

interface AdoptableEntry {
  ds: RedisDataSource;
  fields: Record<string, unknown>;
}

async function previewSourcesFromRedis(session: {
  accessToken?: string;
  org?: string;
}): Promise<{ preview: MigratePreviewSource[]; adoptable: Map<string, AdoptableEntry> }> {
  const redisSources = await fetchRedisDatasources(session);
  if (redisSources.length === 0) return { preview: [], adoptable: new Map() };

  const migratableIds = redisSources
    .map((ds) => ds.datasource_id)
    .filter((id): id is string => Boolean(id));

  const collection = await getCollection<IngestionSourceConfig>("rag_ingestion_sources");
  const existingDocs = migratableIds.length
    ? await collection
        .find({ source_id: { $in: migratableIds } } as never)
        .project({ source_id: 1, config_import_adopted: 1 })
        .toArray()
    : [];
  const existingById = new Map(existingDocs.map((doc) => [doc.source_id, doc]));

  const preview: MigratePreviewSource[] = [];
  const adoptable = new Map<string, AdoptableEntry>();

  for (const ds of redisSources) {
    if (!ds.datasource_id) continue;
    const sourceType = SOURCE_TYPE_MAP[ds.source_type];
    if (!sourceType) continue;

    const existing = existingById.get(ds.datasource_id);
    preview.push({
      source_id: ds.datasource_id,
      name: ds.name ?? ds.datasource_id,
      source_type: sourceType,
      in_db: Boolean(existing),
      already_adopted: existing?.config_import_adopted === true,
    });

    if (!existing) {
      const fields = extractFieldsFromRedis(ds, sourceType);
      if (fields) adoptable.set(ds.datasource_id, { ds, fields });
    }
  }

  return { preview, adoptable };
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun = body.dry_run !== false;

  const { preview, adoptable } = await previewSourcesFromRedis({
    accessToken: session.accessToken,
    org: session.org,
  });

  if (dryRun) {
    return successResponse<MigrateFromConfigResult>({ sources: preview });
  }

  const previewById = new Map(preview.map((s) => [s.source_id, s]));
  const requestedIds = Array.isArray(body.source_ids)
    ? body.source_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : preview.filter((s) => !s.in_db).map((s) => s.source_id);

  const ownerTeamSlug = normalizeString(body.owner_team_slug);
  const sharedTeamSlugsRaw = Array.isArray(body.shared_with_teams)
    ? body.shared_with_teams.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const sharedTeamSlugs = sharedTeamSlugsRaw.filter((slug) => slug !== ownerTeamSlug);

  if (ownerTeamSlug) {
    const teams = await getCollection<Team>("teams");
    const team = await teams.findOne({ slug: ownerTeamSlug } as never);
    if (!team) {
      throw new ApiError(`Owning team "${ownerTeamSlug}" not found`, 404, "OWNER_TEAM_NOT_FOUND");
    }
  }

  const adopted: string[] = [];
  const skipped: MigrateSkip[] = [];

  for (const sourceId of requestedIds) {
    const previewEntry = previewById.get(sourceId);
    if (!previewEntry) {
      skipped.push({ source_id: sourceId, reason: "not_found_in_redis" });
      continue;
    }
    if (previewEntry.in_db) {
      skipped.push({ source_id: sourceId, reason: "already_in_db" });
      continue;
    }
    const entry = adoptable.get(sourceId);
    if (!entry) {
      skipped.push({ source_id: sourceId, reason: "missing_identity_fields" });
      continue;
    }

    await createIngestionSource({
      sourceId,
      fields: entry.fields,
      name: entry.ds.name ?? sourceId,
      description: "",
      ownerTeamSlug,
      sharedWithTeams: sharedTeamSlugs,
      creatorSubject: null,
      ownerSubject: null,
      defaultChunkSize: entry.ds.default_chunk_size,
      defaultChunkOverlap: entry.ds.default_chunk_overlap,
      reloadInterval: entry.ds.reload_interval,
      configImportAdopted: true,
    });
    adopted.push(sourceId);
  }

  return successResponse<MigrateFromConfigResult>({ sources: preview, adopted, skipped });
});
