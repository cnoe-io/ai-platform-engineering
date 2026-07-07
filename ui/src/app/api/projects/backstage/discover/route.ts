// assisted-by Cursor Composer

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  fetchBackstageComponentsForSystem,
  fetchBackstageSystems,
} from "@/lib/projects/backstage-client";
import { buildSyncPreview } from "@/lib/projects/backstage-sync";
import { requireProjectsOrgAdmin } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { session } = await getAuthFromBearerOrSession(request);
  await requireProjectsOrgAdmin(session);

  const systems = await fetchBackstageSystems();
  const projects = await getCollection<ProjectDocument>("projects");
  const existing = await projects.find({}).project({ slug: 1 }).toArray();
  const existingSlugs = new Set(existing.map((p) => p.slug));

  const enriched = await Promise.all(
    systems.map(async (system) => ({
      ...system,
      components: await fetchBackstageComponentsForSystem(system.slug),
      already_imported: existingSlugs.has(system.slug),
    })),
  );

  const existingDocs = await projects.find({}).toArray();
  const existingBySlug = new Map(existingDocs.map((doc) => [doc.slug, doc]));
  const preview = buildSyncPreview(systems, existingBySlug);

  return successResponse({
    systems: enriched,
    preview,
    configured: Boolean(
      process.env.BACKSTAGE_URL?.trim() ||
        process.env.BACKSTAGE_API_URL?.trim(),
    ),
  });
});

export const dynamic = "force-dynamic";
