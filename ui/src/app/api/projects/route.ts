// assisted-by Cursor Composer

import { randomUUID } from "crypto";

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  buildDefaultComponents,
  buildProjectCatalog,
  deriveProjectSlug,
} from "@/lib/projects/backstage-catalog";
import { buildEmptyOnboardingState } from "@/lib/projects/onboarding-config";
import { projectMatchesLabels, sanitizeLabels } from "@/lib/projects/labels";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { CreateProjectRequest, ProjectDocument } from "@/types/projects";
import type { Team } from "@/types/teams";

async function resolveTeam(teamId: string): Promise<Team & { _id: string }> {
  const teams = await getCollection<Team>("teams");
  let team: Team | null = null;

  if (ObjectId.isValid(teamId)) {
    team = await teams.findOne({ _id: new ObjectId(teamId) as never });
  }
  if (!team) {
    team = await teams.findOne({ slug: teamId });
  }
  if (!team) {
    throw new ApiError("Team not found", 404, "TEAM_NOT_FOUND");
  }

  return { ...team, _id: String(team._id) };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  const projects = await getCollection<ProjectDocument>("projects");
  const isAdmin = await canManageProjectsOrganization(session);

  let filter: Record<string, unknown> = {};
  if (!isAdmin) {
    const email = user.email?.trim().toLowerCase();
    if (!email) {
      return successResponse({ projects: [] });
    }
    const userTeams = await getCollection("teams");
    const memberships = await userTeams
      .find({
        $or: [
          { "members.user_id": email },
          { owner_id: email },
        ],
      })
      .project({ _id: 1 })
      .toArray();
    const teamIds = memberships.map((t) => String(t._id));
    filter = { team_id: { $in: teamIds } };
  }

  const all = await projects.find(filter).sort({ updated_at: -1 }).toArray();

  // Label-faceted discovery (FR-006): AND across dimensions, OR within.
  const { searchParams } = new URL(request.url);
  const labelFilter = {
    domains: searchParams.getAll("domain"),
    initiatives: searchParams.getAll("initiative"),
    swimlanes: searchParams.getAll("swimlane"),
  };
  const hasLabelFilter =
    labelFilter.domains.length > 0 ||
    labelFilter.initiatives.length > 0 ||
    labelFilter.swimlanes.length > 0;
  const q = searchParams.get("q")?.trim().toLowerCase();

  let results = all as ProjectDocument[];
  if (hasLabelFilter) {
    results = results.filter((p) => projectMatchesLabels(p, labelFilter));
  }
  if (q) {
    results = results.filter((p) => {
      const hay = [
        p.name,
        p.title,
        p.description,
        p.labels?.domain ?? p.domain,
        ...(p.labels?.initiatives ?? []),
        ...(p.labels?.swimlanes ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  return successResponse({
    projects: results.map((p) => ({
      ...p,
      _id: String(p._id),
    })),
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { user } = await getAuthFromBearerOrSession(request);
  const body = (await request.json()) as CreateProjectRequest;

  if (!body.name?.trim()) {
    throw new ApiError("Project name is required", 400, "VALIDATION_ERROR");
  }
  if (!body.team_id?.trim()) {
    throw new ApiError("Team is required", 400, "VALIDATION_ERROR");
  }

  const team = await resolveTeam(body.team_id);
  const teamSlug = team.slug ?? deriveProjectSlug(team.name);
  const slug = deriveProjectSlug(body.name);
  if (!slug) {
    throw new ApiError("Could not derive project slug from name", 400, "VALIDATION_ERROR");
  }

  const projects = await getCollection<ProjectDocument>("projects");
  const existing = await projects.findOne({ slug, team_id: team._id });
  if (existing) {
    throw new ApiError(
      `Project "${slug}" already exists for this team`,
      409,
      "PROJECT_EXISTS",
    );
  }

  const description =
    body.description?.trim() || `${body.name.trim()} — project`;
  const domain = body.domain?.trim() || "default";
  const tags = body.tags?.length ? body.tags : ["caipe"];
  const memberIds = body.member_ids?.map((m) => m.trim()).filter(Boolean) ?? [];

  // User-shared data sources (repos / Confluence / component URLs). Stored on
  // the project and surfaced to onboarding so connected external apps can
  // ingest them. Also mirrored into integrations so the detail tiles render.
  const cleanUrls = (arr?: string[]): string[] =>
    (arr ?? []).map((u) => u.trim()).filter(Boolean);
  const sources = {
    repos: cleanUrls(body.github_repos),
    confluence_url: body.confluence_url?.trim() || undefined,
    component_urls: cleanUrls(body.component_urls),
  };
  const sourceIntegrations: Record<string, string> = {};
  if (sources.repos[0]) sourceIntegrations.github_url = sources.repos[0];
  if (sources.confluence_url) sourceIntegrations.confluence_url = sources.confluence_url;

  const catalog = buildProjectCatalog({
    name: body.name.trim(),
    description,
    teamSlug,
    domain,
    tags,
    mailer: user.email,
    manager: body.manager,
    ostinatoId: randomUUID(),
  });

  const now = new Date();
  const doc: ProjectDocument = {
    slug,
    name: body.name.trim(),
    title: catalog.metadata.title,
    description,
    team_id: team._id,
    team_slug: teamSlug,
    team_name: team.name,
    owner_id: user.email ?? "unknown",
    member_ids: memberIds,
    domain,
    labels: sanitizeLabels(
      { domain, initiatives: body.initiatives, swimlanes: body.swimlanes },
      domain,
    ),
    tags,
    status: "draft",
    catalog,
    components: buildDefaultComponents(slug, teamSlug, catalog.metadata.title),
    onboarding: buildEmptyOnboardingState(),
    integrations: sourceIntegrations,
    sources,
    source: "manual",
    created_at: now,
    updated_at: now,
  };

  const result = await projects.insertOne(doc as ProjectDocument & { _id?: ObjectId });

  return successResponse(
    { project: { ...doc, _id: String(result.insertedId) } },
    201,
  );
});
