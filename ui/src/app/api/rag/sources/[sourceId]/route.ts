/**
 * `/api/rag/sources/[sourceId]` — GET/PATCH/DELETE on a single ingestion
 * source config record (spec 2026-07-21-rag-source-config-db).
 *
 * GET: 403 (not 404) for an existing-but-unreadable record — matches
 * `ui/src/app/api/rag/kbs/[id]/sharing/route.ts`'s GET, which lets
 * `requireResourcePermission`'s ApiError propagate unchanged.
 *
 * PATCH/DELETE: config-driven check before the can_manage check — an
 * owner-team admin still gets 403 CONFIG_DRIVEN_IMMUTABLE, matching
 * `ui/src/app/api/dynamic-agents/route.ts`'s existing agent PATCH/DELETE
 * ordering (config-driven guard runs first there too).
 */

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { reconcileIngestionSourceRelationships } from "@/lib/rbac/openfga-owned-resources-reconcile";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { IngestionSourceConfig } from "@/types/ingestion-source";
import { NextRequest } from "next/server";

const COLLECTION_NAME = "rag_ingestion_sources";

/** Fields that identify a source and may never change after creation. */
const IMMUTABLE_FIELDS = [
  "source_id",
  "source_type",
  "channel_id",
  "confluence_url",
  "space_key",
  "project_key",
  "source_slug",
  "url",
  "space_id",
] as const;

/** Fields any caller with `can_manage` may update via PATCH. */
const MUTABLE_FIELDS = [
  "name",
  "description",
  "default_chunk_size",
  "default_chunk_overlap",
  "reload_interval",
  "shared_with_teams",
  "lookback_days",
  "include_bots",
  "jql",
  "include_comments",
] as const;

function pickMutableFields(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of MUTABLE_FIELDS) {
    if (body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result;
}

async function loadSource(sourceId: string): Promise<IngestionSourceConfig> {
  const collection = await getCollection<IngestionSourceConfig>(COLLECTION_NAME);
  const source = await collection.findOne({ source_id: sourceId } as never);
  if (!source) {
    throw new ApiError("Source not found", 404, "SOURCE_NOT_FOUND");
  }
  return source;
}

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ sourceId: string }> }) => {
    const { sourceId } = await context.params;
    const { session } = await getAuthFromBearerOrSession(request);

    const source = await loadSource(sourceId);

    await requireResourcePermission(
      session,
      { type: "ingestion_source", id: sourceId, action: "read" },
      { bypassForOrgAdmin: true },
    );

    return successResponse(source);
  },
);

export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ sourceId: string }> }) => {
    const { sourceId } = await context.params;
    const { session } = await getAuthFromBearerOrSession(request);

    const source = await loadSource(sourceId);

    // Config-driven check first — a config-driven record is immutable via
    // the API regardless of who's asking.
    if (source.config_driven) {
      throw new ApiError(
        "Config-driven sources cannot be modified. Update the Helm values instead.",
        403,
        "CONFIG_DRIVEN_IMMUTABLE",
      );
    }

    await requireResourcePermission(
      session,
      { type: "ingestion_source", id: sourceId, action: "manage" },
      { bypassForOrgAdmin: true },
    ).catch(() => {
      throw new ApiError(
        "You do not have permission to manage this source",
        403,
        "FORBIDDEN_MANAGE",
      );
    });

    const body = (await request.json()) as Record<string, unknown>;
    const attemptedImmutableChange = IMMUTABLE_FIELDS.some((field) => body[field] !== undefined);
    if (attemptedImmutableChange) {
      throw new ApiError(
        "Immutable fields cannot be changed via PATCH",
        400,
        "IMMUTABLE_FIELD_CHANGE",
      );
    }

    const updateData = pickMutableFields(body);
    updateData.updated_at = new Date().toISOString();

    const previousSharedTeamSlugs = Array.isArray(source.shared_with_teams)
      ? source.shared_with_teams
      : [];
    const sharedTeamsChanged = Object.prototype.hasOwnProperty.call(updateData, "shared_with_teams");
    const nextSharedTeamSlugs = sharedTeamsChanged
      ? ((updateData.shared_with_teams as string[]) ?? [])
      : previousSharedTeamSlugs;

    if (sharedTeamsChanged) {
      await reconcileIngestionSourceRelationships({
        sourceId,
        creatorSubject: source.creator_subject,
        ownerSubject: source.owner_subject,
        ownerTeamSlug: source.owner_team_slug,
        nextSharedTeamSlugs,
        previousSharedTeamSlugs,
        globalUserAccess: source.visibility === "global",
        previousGlobalUserAccess: source.visibility === "global",
      });
    }

    const collection = await getCollection<IngestionSourceConfig>(COLLECTION_NAME);
    const updated = await collection.findOneAndUpdate(
      { source_id: sourceId } as never,
      { $set: updateData },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new ApiError("Failed to update source", 500);
    }

    return successResponse(updated);
  },
);

export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ sourceId: string }> }) => {
    const { sourceId } = await context.params;
    const { session } = await getAuthFromBearerOrSession(request);

    const source = await loadSource(sourceId);

    if (source.config_driven) {
      throw new ApiError(
        "Config-driven sources cannot be deleted. Remove the Helm values entry instead.",
        403,
        "CONFIG_DRIVEN_IMMUTABLE",
      );
    }

    await requireResourcePermission(
      session,
      { type: "ingestion_source", id: sourceId, action: "manage" },
      { bypassForOrgAdmin: true },
    ).catch(() => {
      throw new ApiError(
        "You do not have permission to manage this source",
        403,
        "FORBIDDEN_MANAGE",
      );
    });

    if (source.status === "ingesting") {
      throw new ApiError("Source is currently ingesting and cannot be deleted", 409, "SOURCE_LOCKED");
    }

    await reconcileIngestionSourceRelationships({
      sourceId,
      creatorSubject: source.creator_subject,
      ownerSubject: source.owner_subject,
      ownerTeamSlug: source.owner_team_slug,
      previousOwnerTeamSlug: source.owner_team_slug,
      nextSharedTeamSlugs: [],
      previousSharedTeamSlugs: source.shared_with_teams ?? [],
      globalUserAccess: false,
      previousGlobalUserAccess: source.visibility === "global",
    });

    const collection = await getCollection<IngestionSourceConfig>(COLLECTION_NAME);
    await collection.deleteOne({ source_id: sourceId } as never);

    return successResponse({ deleted: sourceId });
  },
);
