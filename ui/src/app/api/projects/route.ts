// assisted-by Cursor Composer

import { randomUUID } from "crypto";

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import {
  ApiError,
  getAuthFromBearerOrSession,
  getUserTeamIds,
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
import { isBootstrapAdmin } from "@/lib/auth-config";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import type { CreateProjectRequest, ProjectDocument, ProjectType } from "@/types/projects";
import type { Team } from "@/types/teams";

async function resolveTeam(teamId: string): Promise<Team & { _id: string }> {
  const teams = await getCollection<Team>("teams");
  let team: Team | null = null;

  if (ObjectId.isValid(teamId)) {
    team = await teams.findOne({ _id: new ObjectId(teamId) as unknown as string });
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
  // Bootstrap admins are honored for bearer/API-key callers too (the OpenFGA
  // org-manage check needs a Keycloak access token, which only cookie sessions
  // carry) — so the Tome MCP lists the same projects an admin sees in the UI.
  const isAdmin =
    (await canManageProjectsOrganization(session)) || isBootstrapAdmin(user.email);

  let filter: Record<string, unknown> = {};
  if (!isAdmin) {
    const email = user.email?.trim().toLowerCase();
    if (!email) {
      return successResponse({ projects: [] });
    }
    const teamIds = await getUserTeamIds(email);
    filter = { team_id: { $in: teamIds } };
  }

  // Kind filter. BHAGs share the `projects` collection (type:"bhag") but are a
  // distinct surface, so they must not leak into the normal project grid or any
  // existing consumer. Default = real projects only (type "project" or legacy
  // docs with no type). `?type=bhag` returns only BHAGs; `?type=all` returns
  // everything.
  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type");
  if (typeParam === "bhag") {
    filter.type = "bhag";
  } else if (typeParam !== "all") {
    filter.$or = [{ type: "project" }, { type: { $exists: false } }];
  }

  const all = await projects.find(filter).sort({ updated_at: -1 }).toArray();

  // Label-faceted discovery (FR-006): AND across dimensions, OR within.
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

  // Enrich with Tome wiki metadata (page count + last ingest).
  // Both aggregations are scoped to the visible project set — no N+1.
  const projectIds = results.map((p) => String(p._id));
  const pageCountMap = new Map<string, number>();
  const lastIngestMap = new Map<string, Date | null>();

  if (projectIds.length > 0) {
    try {
      const [pageRevisions, ingestRuns] = await Promise.all([
        getCollection("tome_page_revisions"),
        getCollection("tome_ingest_runs"),
      ]);
      const [pageCounts, lastIngests] = await Promise.all([
        pageRevisions.aggregate([
          { $match: { project_id: { $in: projectIds }, deleted: { $ne: true } } },
          { $sort: { project_id: 1, path: 1, created_at: -1 } },
          { $group: { _id: { project_id: "$project_id", path: "$path" } } },
          { $group: { _id: "$_id.project_id", count: { $sum: 1 } } },
        ]).toArray(),
        ingestRuns.aggregate([
          { $match: { project_id: { $in: projectIds }, status: "succeeded" } },
          { $group: { _id: "$project_id", last_ingested_at: { $max: "$finished_at" } } },
        ]).toArray(),
      ]);
      for (const row of pageCounts) {
        pageCountMap.set(String(row._id), row.count as number);
      }
      for (const row of lastIngests) {
        lastIngestMap.set(String(row._id), row.last_ingested_at as Date);
      }
    } catch {
      // Tome collections not present — enrichment is optional
    }
  }

  return successResponse({
    projects: results.map((p) => {
      const id = String(p._id);
      return {
        ...p,
        _id: id,
        page_count: pageCountMap.get(id) ?? null,
        last_ingested_at: lastIngestMap.get(id) ?? null,
      };
    }),
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
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

  // A BHAG is synthesis-only: it has no connectors of its own (its sources are
  // the wikis of the projects tagged to it), so we ignore any source inputs.
  const projectType: ProjectType = body.type === "bhag" ? "bhag" : "project";
  const isBhag = projectType === "bhag";

  const description =
    body.description?.trim() ||
    (isBhag ? `${body.name.trim()} — strategic goal` : `${body.name.trim()} — project`);
  const domain = body.domain?.trim() || "default";
  const tags = body.tags?.length ? body.tags : ["caipe"];
  const memberIds = body.member_ids?.map((m) => m.trim()).filter(Boolean) ?? [];

  // User-shared data sources (repos / Confluence / component URLs). Stored on
  // the project and surfaced to onboarding so connected external apps can
  // ingest them. Also mirrored into integrations so the detail tiles render.
  const cleanUrls = (arr?: string[]): string[] =>
    (arr ?? []).map((u) => u.trim()).filter(Boolean);
  const cleanWebexRooms = (rooms?: typeof body.webex_rooms) =>
    (rooms ?? [])
      .filter((r) => r && typeof r.room_id === "string" && r.room_id.trim())
      .map((r) => ({
        room_id: r.room_id.trim(),
        name: (r.name ?? "").trim() || r.room_id.trim(),
        slug: (r.slug ?? "").trim(),
      }));
  const sources = isBhag
    ? { repos: [], confluence_url: undefined, component_urls: [], webex_rooms: [] }
    : {
        repos: cleanUrls(body.github_repos),
        confluence_url: body.confluence_url?.trim() || undefined,
        component_urls: cleanUrls(body.component_urls),
        webex_rooms: cleanWebexRooms(body.webex_rooms),
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
    type: projectType,
    slug,
    name: body.name.trim(),
    title: catalog.metadata.title,
    description,
    team_id: team._id,
    team_slug: teamSlug,
    team_name: team.name,
    owner_id: user.email ?? "unknown",
    member_ids: memberIds,
    // Feed data steward: set explicitly at creation so it's never a magic
    // "blank means owner". BHAGs have no sources, so no steward.
    ...(isBhag
      ? {}
      : { data_steward: body.data_steward?.trim().toLowerCase() || user.email }),
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

  auditTome({
    action: "tome.project.create",
    actor: tomeActorFromAuth({ user, session }),
    projectSlug: slug,
    metadata: { type: projectType, name: doc.name, team_slug: teamSlug },
  });

  return successResponse(
    { project: { ...doc, _id: String(result.insertedId) } },
    201,
  );
});
