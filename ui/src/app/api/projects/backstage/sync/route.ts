// assisted-by Cursor Composer

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  entityToSystemSummary,
  fetchBackstageComponentsForSystem,
  fetchBackstageSystems,
  type BackstageCatalogEntity,
} from "@/lib/projects/backstage-client";
import {
  applyBackstageToProject,
  buildSyncPreview,
  type BackstageConflictResolution,
} from "@/lib/projects/backstage-sync";
import { buildEmptyOnboardingState } from "@/lib/projects/onboarding-config";
import { requireProjectsOrgAdmin } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";
import { ObjectId } from "mongodb";

interface SyncRequestBody {
  slugs: string[];
  team_id?: string;
}

interface ResolveRequestBody {
  items: Array<{
    slug: string;
    resolution: BackstageConflictResolution;
    team_id?: string;
  }>;
}

async function resolveTeam(teamId: string) {
  const teams = await getCollection("teams");
  let team = ObjectId.isValid(teamId)
    ? await teams.findOne({ _id: new ObjectId(teamId) })
    : null;
  if (!team) {
    team = await teams.findOne({ slug: teamId });
  }
  if (!team) {
    throw new ApiError("Team not found", 404, "TEAM_NOT_FOUND");
  }
  return {
    _id: String(team._id),
    name: String(team.name ?? teamId),
    slug: String(team.slug ?? teamId),
  };
}

async function loadSystemsBySlugs(slugs: string[]) {
  const all = await fetchBackstageSystems();
  const wanted = new Set(slugs);
  return all.filter((system) => wanted.has(system.slug));
}

/** Preview import and surface conflicts without writing. */
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { session, user } = await getAuthFromBearerOrSession(request);
  await requireProjectsOrgAdmin(session);

  const body = (await request.json()) as SyncRequestBody;
  const slugs = body.slugs?.map((slug) => slug.trim()).filter(Boolean) ?? [];
  if (slugs.length === 0) {
    throw new ApiError("Select at least one project", 400, "VALIDATION_ERROR");
  }

  if (body.team_id?.trim()) {
    await resolveTeam(body.team_id);
  }

  const systems = await loadSystemsBySlugs(slugs);
  if (systems.length === 0) {
    throw new ApiError("No matching Backstage systems found", 404, "NOT_FOUND");
  }

  const projects = await getCollection<ProjectDocument>("projects");
  const existingDocs = await projects
    .find({ slug: { $in: slugs } })
    .toArray();
  const existingBySlug = new Map(existingDocs.map((doc) => [doc.slug, doc]));
  const preview = buildSyncPreview(systems, existingBySlug);

  return successResponse({
    preview,
    actor: user.email,
  });
});

/** Apply selected imports and conflict resolutions. */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { session, user } = await getAuthFromBearerOrSession(request);
  await requireProjectsOrgAdmin(session);

  const body = (await request.json()) as ResolveRequestBody;
  const items = body.items ?? [];
  if (items.length === 0) {
    throw new ApiError("No sync items provided", 400, "VALIDATION_ERROR");
  }

  const slugs = items.map((item) => item.slug);
  const systems = await loadSystemsBySlugs(slugs);
  const systemBySlug = new Map(systems.map((system) => [system.slug, system]));

  const projects = await getCollection<ProjectDocument>("projects");
  const results: Array<{
    slug: string;
    action: "created" | "updated" | "skipped";
    project_id?: string;
  }> = [];

  for (const item of items) {
    const summary = systemBySlug.get(item.slug);
    if (!summary) {
      results.push({ slug: item.slug, action: "skipped" });
      continue;
    }

    summary.components = await fetchBackstageComponentsForSystem(summary.slug);
    const existing = await projects.findOne({ slug: item.slug });

    if (existing && item.resolution === "keep_local") {
      results.push({ slug: item.slug, action: "skipped", project_id: String(existing._id) });
      continue;
    }

    const team = item.team_id ? await resolveTeam(item.team_id) : undefined;

    if (!existing) {
      if (!team) {
        throw new ApiError(
          `team_id is required to import "${item.slug}"`,
          400,
          "VALIDATION_ERROR",
        );
      }

      const now = new Date();
      const doc: ProjectDocument = {
        slug: summary.slug,
        name: summary.slug,
        title: summary.title,
        description: summary.description,
        team_id: team._id,
        team_slug: team.slug,
        team_name: team.name,
        owner_id: user.email ?? "unknown",
        member_ids: [],
        domain: summary.domain,
        tags: summary.tags,
        status: "active",
        catalog: summary.catalog,
        components: summary.components,
        onboarding: buildEmptyOnboardingState(),
        integrations: {},
        source: "backstage",
        backstage_entity_ref: summary.entityRef,
        created_at: now,
        updated_at: now,
      };

      const inserted = await projects.insertOne(doc as ProjectDocument & { _id?: ObjectId });
      results.push({
        slug: item.slug,
        action: "created",
        project_id: String(inserted.insertedId),
      });
      continue;
    }

    const patch = applyBackstageToProject(
      existing,
      summary,
      item.resolution,
      team,
    );

    if (Object.keys(patch).length === 0) {
      results.push({ slug: item.slug, action: "skipped", project_id: String(existing._id) });
      continue;
    }

    await projects.updateOne({ _id: existing._id }, { $set: patch });
    results.push({ slug: item.slug, action: "updated", project_id: String(existing._id) });
  }

  return successResponse({ results });
});

export const dynamic = "force-dynamic";

// Re-export for tests that import entity helpers
export { entityToSystemSummary, type BackstageCatalogEntity };
