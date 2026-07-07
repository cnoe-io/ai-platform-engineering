// assisted-by Cursor Composer

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { projectCatalogBundleYaml } from "@/lib/projects/backstage-catalog";
import { runOnboardingDeletes, runOnboardingUpdates } from "@/lib/projects/onboarding-providers";
import { canManageProjectsOrganization, isProjectTeamMember } from "@/lib/projects/project-admin";
import { cleanLabelList } from "@/lib/projects/labels";
import { isBootstrapAdmin } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { auditTome, tomeActorFromAuth, type TomeAuditActor } from "@/lib/tome/audit";
import type { ProjectDocument } from "@/types/projects";
import type { Team } from "@/types/teams";
import type { TeamMembershipSource } from "@/types/identity-group-sync";

/**
 * Resolve a team by Mongo `_id` (string) or `slug`. Returns the team with a
 * stringified `_id`, or null when not found.
 */
async function resolveTeamByIdOrSlug(
  idOrSlug: string,
): Promise<(Team & { _id: string }) | null> {
  const teams = await getCollection<Team>("teams");
  let team: Team | null = null;
  if (ObjectId.isValid(idOrSlug)) {
    team = await teams.findOne({ _id: new ObjectId(idOrSlug) as unknown as string });
  }
  if (!team) team = await teams.findOne({ slug: idOrSlug });
  return team ? { ...team, _id: String(team._id) } : null;
}

/**
 * May `actorEmail` assign a project to `team`? True for org admins, or when the
 * actor has an active canonical membership row for the target team. Mirrors the
 * gate used by `/api/dynamic-agents/teams` (the selector source).
 */
async function canAssignToTeam(
  team: Team & { _id: string },
  actorEmail: string | undefined,
  isOrgAdmin: boolean,
): Promise<boolean> {
  if (isOrgAdmin) return true;
  const email = actorEmail?.trim().toLowerCase();
  if (!email || !team.slug) return false;
  const sources = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
  const row = await sources.findOne({
    status: "active",
    user_email: email,
    team_slug: team.slug,
  });
  return Boolean(row);
}

/** Emit `tome.source.attach`/`detach` events for what changed between the
 * project's sources before and after a PATCH. Repos + Confluence URL compared
 * by value; Webex rooms by `room_id`. */
function auditSourceChanges(
  slug: string,
  actor: TomeAuditActor,
  before: ProjectDocument["sources"] | undefined,
  after: ProjectDocument["sources"] | undefined,
): void {
  const emit = (
    action: "tome.source.attach" | "tome.source.detach",
    sourceType: string,
    ref: string,
  ) => auditTome({ action, actor, projectSlug: slug, metadata: { source_type: sourceType, ref } });

  const diffList = (type: string, oldArr: string[], newArr: string[]) => {
    const o = new Set(oldArr.filter(Boolean));
    const n = new Set(newArr.filter(Boolean));
    for (const ref of n) if (!o.has(ref)) emit("tome.source.attach", type, ref);
    for (const ref of o) if (!n.has(ref)) emit("tome.source.detach", type, ref);
  };

  diffList("repo", before?.repos ?? [], after?.repos ?? []);
  diffList(
    "webex_room",
    (before?.webex_rooms ?? []).map((r) => r.room_id).filter(Boolean),
    (after?.webex_rooms ?? []).map((r) => r.room_id).filter(Boolean),
  );
  const oldConf = before?.confluence_url?.trim() || "";
  const newConf = after?.confluence_url?.trim() || "";
  if (oldConf !== newConf) {
    if (newConf) emit("tome.source.attach", "confluence", newConf);
    else if (oldConf) emit("tome.source.detach", "confluence", oldConf);
  }
}

export const GET = withErrorHandler(
  async (_request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    await getAuthFromBearerOrSession(_request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await projects.findOne({ slug });
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    return successResponse({
      project: {
        ...project,
        _id: String(project._id),
      },
      catalog_yaml: projectCatalogBundleYaml(project),
    });
  },
);

// DELETE a project. Allowed for the project owner or a projects-org admin.
// Cascades to external resources for onboarding steps configured with a
// `deleteEndpoint` (best-effort) before removing the CAIPE record.
export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    const { user, session } = await getAuthFromBearerOrSession(request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await projects.findOne({ slug });
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    const isOwner = Boolean(user.email) && project.owner_id === user.email;
    const isOrgAdmin =
      (await canManageProjectsOrganization(session)) || isBootstrapAdmin(user.email);
    if (!isOwner && !isOrgAdmin) {
      throw new ApiError(
        "You can only delete projects you own (or as a projects admin)",
        403,
        "FORBIDDEN",
      );
    }

    // Cascade external deletions first (best-effort; never blocks the local
    // delete). Uses the OIDC sub so the external system authorizes the actor.
    const sub = (session as { sub?: string } | undefined)?.sub;
    const externalDeletes = await runOnboardingDeletes(project, sub);

    await projects.deleteOne({ _id: project._id });

    auditTome({
      action: "tome.project.delete",
      actor: tomeActorFromAuth({ user, session }),
      projectSlug: slug,
      metadata: { type: project.type ?? "project", name: project.name },
    });

    return successResponse({ deleted: true, slug, external: externalDeletes });
  },
);

// PATCH a project's editable fields (title, description, sources).
// Allowed for the project owner or a projects-org admin.
// Syncs changes to external resources via configured `updateEndpoint` steps.
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    const { user, session } = await getAuthFromBearerOrSession(request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await projects.findOne({ slug });
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    const isOwner = Boolean(user.email) && project.owner_id === user.email;
    const isOrgAdmin =
      (await canManageProjectsOrganization(session)) || isBootstrapAdmin(user.email);
    // Team members can edit a project too, matching project visibility (which is
    // team-based). Without this, a teammate who can see a project can't save it.
    const isTeamMember = await isProjectTeamMember(project, user.email);
    if (!isOwner && !isOrgAdmin && !isTeamMember) {
      throw new ApiError(
        "You can only edit projects on your team (or as a projects admin)",
        403,
        "FORBIDDEN",
      );
    }

    const body = (await request.json()) as {
      title?: string;
      description?: string;
      initiatives?: string[];
      swimlanes?: string[];
      team_id?: string;
      sources?: {
        repos?: string[];
        confluence_url?: string;
        webex_rooms?: Array<{ room_id?: string; name?: string; slug?: string }>;
      };
      /** Feed data steward (email): the principal the source feed runs as. */
      data_steward?: string | null;
      /** Per-project source-feed on/off. */
      sources_feed_enabled?: boolean;
    };

    // Steward assignment + feed toggle are governance actions: owner or org
    // admin only, not a plain team-member editor.
    const touchesFeedGovernance =
      "data_steward" in body || "sources_feed_enabled" in body;
    if (touchesFeedGovernance && !isOwner && !isOrgAdmin) {
      throw new ApiError(
        "Only the project owner or an admin can change the data steward or feed settings",
        403,
        "FORBIDDEN",
      );
    }

    const $set: Record<string, unknown> = { updated_at: new Date() };
    if (typeof body.title === "string" && body.title.trim()) {
      $set["title"] = body.title.trim();
    }
    if (typeof body.description === "string") {
      $set["description"] = body.description.trim();
    }
    // Label dimensions (BHAG/Initiative + Swim Lane). Dot-path writes preserve
    // `labels.domain`, which isn't editable here.
    if (Array.isArray(body.initiatives)) {
      $set["labels.initiatives"] = cleanLabelList(body.initiatives);
    }
    if (Array.isArray(body.swimlanes)) {
      $set["labels.swimlanes"] = cleanLabelList(body.swimlanes);
    }
    // Team reassignment — only when it actually changes, and only if the actor
    // is allowed to move the project into the target team. Updates the team
    // triple (id/slug/name) that drives RBAC visibility.
    if (typeof body.team_id === "string" && body.team_id.trim()) {
      const target = await resolveTeamByIdOrSlug(body.team_id.trim());
      if (!target) {
        throw new ApiError("Target team not found", 404, "TEAM_NOT_FOUND");
      }
      if (target._id !== project.team_id && target.slug !== project.team_slug) {
        const allowed = await canAssignToTeam(target, user.email, isOrgAdmin);
        if (!allowed) {
          throw new ApiError(
            "You are not allowed to move this project into that team",
            403,
            "FORBIDDEN_TEAM_ASSIGNMENT",
          );
        }
        $set["team_id"] = target._id;
        $set["team_slug"] = target.slug ?? target._id;
        $set["team_name"] = target.name;
      }
    }
    const $unset: Record<string, ""> = {};
    if ("data_steward" in body) {
      // Empty/null clears the steward → the feed falls back to the owner.
      const steward = (body.data_steward ?? "").trim().toLowerCase();
      if (steward) $set["data_steward"] = steward;
      else $unset["data_steward"] = "";
    }
    if (typeof body.sources_feed_enabled === "boolean") {
      $set["sources_feed_enabled"] = body.sources_feed_enabled;
    }
    if (body.sources) {
      if (Array.isArray(body.sources.repos)) {
        $set["sources.repos"] = body.sources.repos.map((r) => r.trim()).filter(Boolean);
      }
      if (typeof body.sources.confluence_url === "string") {
        $set["sources.confluence_url"] = body.sources.confluence_url.trim();
      }
      if (Array.isArray(body.sources.webex_rooms)) {
        $set["sources.webex_rooms"] = body.sources.webex_rooms
          .filter((r) => r && typeof r.room_id === "string" && r.room_id.trim())
          .map((r) => ({
            room_id: r.room_id!.trim(),
            name: (r.name ?? "").trim() || r.room_id!.trim(),
            slug: (r.slug ?? "").trim(),
          }));
      }
    }

    await projects.updateOne(
      { _id: project._id },
      Object.keys($unset).length > 0 ? { $set, $unset } : { $set },
    );

    const updated = await projects.findOne({ slug });
    if (!updated) throw new ApiError("Project not found after update", 500, "UPDATE_FAILED");

    const sub = (session as { sub?: string } | undefined)?.sub;
    const externalUpdates = await runOnboardingUpdates(updated, sub);

    const actor = tomeActorFromAuth({ user, session });
    // Metadata edit vs source change are distinct audit actions; a PATCH can be
    // either or both.
    const metaChanged = [
      "title",
      "description",
      "labels.initiatives",
      "labels.swimlanes",
      "team_id",
    ].some((k) => k in $set);
    if (metaChanged) {
      auditTome({ action: "tome.project.update", actor, projectSlug: slug });
    }
    if (body.sources) {
      auditSourceChanges(slug, actor, project.sources, updated.sources);
    }

    return successResponse({
      project: { ...updated, _id: String(updated._id) },
      external: externalUpdates,
    });
  },
);
