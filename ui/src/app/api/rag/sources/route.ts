/**
 * API routes for RAG ingestion-source configuration
 * (spec 2026-07-21-rag-source-config-db).
 *
 * `IngestionSourceConfig` is the pre-ingestion source of truth this series
 * introduces — distinct from the RAG server's `DataSourceInfo`. See
 * docs/docs/specs/2026-07-21-rag-source-config-db/data-model.md.
 *
 * POST creates a UI/API-native record (`config_driven: false`,
 * `visibility: "team"`) — config-driven records are seeded exclusively via
 * `ui/src/lib/seed-config.ts`'s `seedRagSources`, never through this route.
 */

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  computeIngestionSourceId,
  type IngestionSourceIdentity,
} from "@/lib/ingestion-source-id";
import { getCollection } from "@/lib/mongodb";
import { reconcileIngestionSourceRelationships } from "@/lib/rbac/openfga-owned-resources-reconcile";
import { caipeOrgKey } from "@/lib/rbac/organization";
import {
  filterResourcesByPermission,
  requireResourcePermission,
} from "@/lib/rbac/resource-authz";
import type {
  IngestionSourceConfig,
  IngestionSourceType,
} from "@/types/ingestion-source";
import { NextRequest } from "next/server";

const COLLECTION_NAME = "rag_ingestion_sources";

const INGESTION_SOURCE_TYPES: readonly IngestionSourceType[] = [
  "slack_channel",
  "confluence_space",
  "jira_project",
  "web_url",
  "webex_space",
];

const DEFAULT_CHUNK_SIZE = 10000;
const DEFAULT_CHUNK_OVERLAP = 2000;
const DEFAULT_RELOAD_INTERVAL = 86400;

interface TeamOwnershipDoc {
  _id?: unknown;
  slug?: string;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function loadOwnerTeam(slug: string): Promise<TeamOwnershipDoc | null> {
  const teams = await getCollection<TeamOwnershipDoc>("teams");
  return teams.findOne({ slug } as never);
}

async function canManageOrganization(
  session: Parameters<typeof requireResourcePermission>[0],
): Promise<boolean> {
  try {
    await requireResourcePermission(session, {
      type: "organization",
      id: caipeOrgKey(),
      action: "manage",
    });
    return true;
  } catch {
    return false;
  }
}

async function canUseTeamSlug(
  session: Parameters<typeof requireResourcePermission>[0],
  teamSlug: string,
): Promise<boolean> {
  try {
    await requireResourcePermission(session, { type: "team", id: teamSlug, action: "use" });
    return true;
  } catch {
    try {
      await requireResourcePermission(session, { type: "team", id: teamSlug, action: "manage" });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Resolve type-specific identity fields required to derive `source_id`, and
 * validate that all required fields for the declared `source_type` are
 * present. Returns `null` if `source_type` is missing/unknown.
 */
function extractSourceIdentity(
  body: Record<string, unknown>,
): { identity: IngestionSourceIdentity; fields: Record<string, unknown> } | null {
  const sourceType = body.source_type as IngestionSourceType | undefined;
  if (!sourceType || !INGESTION_SOURCE_TYPES.includes(sourceType)) return null;

  switch (sourceType) {
    case "slack_channel": {
      const channelId = normalizeString(body.channel_id);
      if (!channelId) return null;
      return {
        identity: { source_type: "slack_channel", channel_id: channelId },
        fields: {
          source_type: sourceType,
          channel_id: channelId,
          lookback_days: body.lookback_days as number | undefined,
          include_bots: body.include_bots as boolean | undefined,
        },
      };
    }
    case "confluence_space": {
      const confluenceUrl = normalizeString(body.confluence_url);
      const spaceKey = normalizeString(body.space_key);
      if (!confluenceUrl || !spaceKey) return null;
      return {
        identity: { source_type: "confluence_space", confluence_url: confluenceUrl, space_key: spaceKey },
        fields: { source_type: sourceType, confluence_url: confluenceUrl, space_key: spaceKey },
      };
    }
    case "jira_project": {
      const projectKey = normalizeString(body.project_key);
      const sourceSlug = normalizeString(body.source_slug);
      if (!projectKey || !sourceSlug) return null;
      return {
        identity: { source_type: "jira_project", project_key: projectKey, source_slug: sourceSlug },
        fields: {
          source_type: sourceType,
          project_key: projectKey,
          source_slug: sourceSlug,
          jql: normalizeString(body.jql) ?? "",
          include_comments: body.include_comments as boolean | undefined,
        },
      };
    }
    case "web_url": {
      const url = normalizeString(body.url);
      if (!url) return null;
      return {
        identity: { source_type: "web_url", url },
        fields: { source_type: sourceType, url },
      };
    }
    case "webex_space": {
      const spaceId = normalizeString(body.space_id);
      if (!spaceId) return null;
      return {
        identity: { source_type: "webex_space", space_id: spaceId },
        fields: { source_type: sourceType, space_id: spaceId },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// GET — list sources
// ═══════════════════════════════════════════════════════════════

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

  const { searchParams } = new URL(request.url);
  const sourceType = searchParams.get("source_type");
  const ownerTeamSlug = searchParams.get("owner_team_slug");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 200;

  const query: Record<string, unknown> = {};
  if (sourceType) query.source_type = sourceType;
  if (ownerTeamSlug) query.owner_team_slug = ownerTeamSlug;

  const collection = await getCollection<IngestionSourceConfig>(COLLECTION_NAME);
  const results = await collection
    .find(query as never)
    .sort({ updated_at: -1 })
    .limit(limit)
    .toArray();

  const visibleResults = await filterResourcesByPermission(
    session,
    results,
    { type: "ingestion_source", action: "read", id: (source) => source.source_id },
    { bypassForOrgAdmin: true },
  );

  return successResponse({ sources: visibleResults });
});

// ═══════════════════════════════════════════════════════════════
// POST — create source
// ═══════════════════════════════════════════════════════════════

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

  const rawBody = (await request.json()) as Record<string, unknown>;
  // config_driven/visibility are server-controlled on this path; never
  // accept caller-supplied values for either.
  const body = { ...rawBody };
  delete body.config_driven;
  delete body.visibility;

  const name = normalizeString(body.name);
  if (!name) {
    throw new ApiError("name is required", 400, "INVALID_SOURCE_PAYLOAD");
  }

  const extracted = extractSourceIdentity(body);
  if (!extracted) {
    throw new ApiError(
      "source_type is missing/unknown, or a required identity field for the declared source_type is missing",
      400,
      "INVALID_SOURCE_PAYLOAD",
    );
  }

  const ownerTeamSlug = normalizeString(body.owner_team_slug);
  if (!ownerTeamSlug) {
    throw new ApiError("owner_team_slug is required", 400, "INVALID_SOURCE_PAYLOAD");
  }
  const ownerTeam = await loadOwnerTeam(ownerTeamSlug);
  if (!ownerTeam) {
    throw new ApiError("Owner team not found", 404, "OWNER_TEAM_NOT_FOUND");
  }
  const canUseOwner =
    (await canUseTeamSlug(session, ownerTeamSlug)) || (await canManageOrganization(session));
  if (!canUseOwner) {
    throw new ApiError(
      "You must belong to the owner team to create this source",
      403,
      "FORBIDDEN_OWNER_TEAM",
    );
  }

  const sharedWithTeamsRaw = Array.isArray(body.shared_with_teams)
    ? (body.shared_with_teams as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const sharedWithTeams = sharedWithTeamsRaw.filter((slug) => slug !== ownerTeamSlug);

  const sourceId = computeIngestionSourceId(extracted.identity);
  const collection = await getCollection<IngestionSourceConfig>(COLLECTION_NAME);
  const existing = await collection.findOne({ source_id: sourceId } as never);
  if (existing) {
    throw new ApiError(
      `A source with id "${sourceId}" already exists`,
      409,
      "SOURCE_ALREADY_EXISTS",
    );
  }

  const now = new Date().toISOString();
  const doc = {
    source_id: sourceId,
    ...extracted.fields,
    name,
    description: normalizeString(body.description) ?? "",
    status: "pending",
    default_chunk_size: (body.default_chunk_size as number) ?? DEFAULT_CHUNK_SIZE,
    default_chunk_overlap: (body.default_chunk_overlap as number) ?? DEFAULT_CHUNK_OVERLAP,
    reload_interval: (body.reload_interval as number) ?? DEFAULT_RELOAD_INTERVAL,
    config_driven: false,
    config_import_adopted: false,
    visibility: "team",
    creator_subject: normalizeString(session.sub) ?? undefined,
    owner_subject: normalizeString(session.sub) ?? undefined,
    owner_team_slug: ownerTeamSlug,
    shared_with_teams: sharedWithTeams,
    created_at: now,
    updated_at: now,
  } as unknown as IngestionSourceConfig;

  await reconcileIngestionSourceRelationships({
    sourceId,
    creatorSubject: doc.creator_subject,
    ownerSubject: doc.owner_subject,
    ownerTeamSlug,
    nextSharedTeamSlugs: sharedWithTeams,
    previousSharedTeamSlugs: [],
    globalUserAccess: false,
  });

  await collection.insertOne(doc as never);

  return successResponse(doc, 201);
});
