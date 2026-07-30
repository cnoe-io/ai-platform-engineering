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
import {
  normalizeConfluencePageScope,
  normalizeConfluencePageScopes,
} from "@/lib/projects/confluence-source";
import { runOnboardingDeletes, runOnboardingUpdates } from "@/lib/projects/onboarding-providers";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";
import { cleanLabelList } from "@/lib/projects/labels";
import { isBootstrapAdmin } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { auditTome, tomeActorFromAuth, type TomeAuditActor } from "@/lib/tome/audit";
import {
  getTomeReadConfiguration,
  invalidateTomeReadAccessCatalogCache,
  reconcileTomeReadAccess,
  removeTomeReadAccess,
} from "@/lib/tome/access";
import {
  dataStewardOpenFgaSubject,
  getTomeProjectPermissions,
  reconcileDataSteward,
  resolveDataSteward,
} from "@/lib/tome/data-steward";
import type { DataStewardInput, ProjectDocument } from "@/types/projects";
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

    const { user, session } = await getAuthFromBearerOrSession(_request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await projects.findOne({ slug });
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    const permissions = await getTomeProjectPermissions({ project, user, session });
    if (!permissions.canRead) {
      throw new ApiError(
        "This Tome entity is not shared with one of your teams",
        403,
        "TOME_READ_REQUIRED",
      );
    }
    const [readConfiguration, steward] = await Promise.all([
      getTomeReadConfiguration(project),
      resolveDataSteward(project.data_steward).catch(() => null),
    ]);
    return successResponse({
      project: {
        ...project,
        _id: String(project._id),
      },
      permissions: {
        can_read: permissions.canRead,
        can_edit: permissions.canEdit,
        can_manage_steward: permissions.canManageSteward,
      },
      rbac: {
        ...readConfiguration,
        dataSteward: steward
          ? {
              type: steward.type,
              name: steward.name,
              subject: dataStewardOpenFgaSubject(steward),
              relation: "writer",
            }
          : null,
        tomeAdminOverride: "admin_surface:tome#can_manage",
      },
      catalog_yaml: projectCatalogBundleYaml(project),
    });
  },
);

// DELETE an entity. Regular projects may be deleted by their OpenFGA data
// steward or a Tome admin. BHAGs and Areas shape the shared hierarchy, so only
// Tome admins may delete them.
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

    const permissions = await getTomeProjectPermissions({ project, user, session });
    if (
      (project.type === "bhag" || project.type === "area") &&
      !permissions.canManageSteward
    ) {
      throw new ApiError(
        "Only a Tome admin can delete a BHAG or Area",
        403,
        "TOME_ADMIN_REQUIRED",
      );
    }
    if (!permissions.canEdit) {
      throw new ApiError(
        "Only this entity's data steward or a Tome admin can delete it",
        403,
        "DATA_STEWARD_REQUIRED",
      );
    }

    // Cascade external deletions first (best-effort; never blocks the local
    // delete). Uses the OIDC sub so the external system authorizes the actor.
    const sub = (session as { sub?: string } | undefined)?.sub;
    const externalDeletes = await runOnboardingDeletes(project, sub);

    await Promise.all([
      removeTomeReadAccess(project),
      reconcileDataSteward(project, null),
    ]);
    await projects.deleteOne({ _id: project._id });
    invalidateTomeReadAccessCatalogCache();

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
// Allowed for its OpenFGA data steward or a Tome admin. Steward assignment
// itself remains Tome-admin-only.
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

    const permissions = await getTomeProjectPermissions({ project, user, session });
    const isOrgAdmin =
      permissions.canManageSteward ||
      (await canManageProjectsOrganization(session)) ||
      isBootstrapAdmin(user.email);
    if (!permissions.canEdit) {
      throw new ApiError(
        "Only this entity's data steward or a Tome admin can edit it",
        403,
        "DATA_STEWARD_REQUIRED",
      );
    }

    const body = (await request.json()) as {
      title?: string;
      description?: string;
      initiatives?: string[];
      areas?: string[];
      team_id?: string;
      sources?: {
        repos?: string[];
        confluence_url?: string;
        confluence_page_scopes?: unknown;
        confluence_page_scope?: unknown;
        webex_rooms?: Array<{ room_id?: string; name?: string; slug?: string }>;
      };
      /** Scoped user/team steward for this Project, Area, or BHAG. */
      data_steward?: DataStewardInput | null;
      /** Per-project source-feed on/off. */
      sources_feed_enabled?: boolean;
      decision_blast_radius?: "small" | "large" | null;
      optionality?: string[];
    };

    if ("data_steward" in body && !permissions.canManageSteward) {
      throw new ApiError(
        "Only a Tome admin can change the data steward",
        403,
        "TOME_ADMIN_REQUIRED",
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
    if (Array.isArray(body.areas)) {
      $set["labels.areas"] = cleanLabelList(body.areas);
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
    let nextDataSteward = null;
    if ("data_steward" in body) {
      if (!body.data_steward) {
        throw new ApiError(
          "A Project, Area, or BHAG must have a data steward",
          400,
          "DATA_STEWARD_REQUIRED",
        );
      }
      nextDataSteward = await resolveDataSteward(body.data_steward);
      if (!nextDataSteward) {
        throw new ApiError("Data steward is required", 400, "DATA_STEWARD_REQUIRED");
      }
      $set["data_steward"] = nextDataSteward;
    }
    if (typeof body.sources_feed_enabled === "boolean") {
      $set["sources_feed_enabled"] = body.sources_feed_enabled;
    }
    if ("decision_blast_radius" in body) {
      if (body.decision_blast_radius) $set["decision_blast_radius"] = body.decision_blast_radius;
      else $unset["decision_blast_radius"] = "";
    }
    if (Array.isArray(body.optionality)) {
      if (body.optionality.length) $set["optionality"] = body.optionality;
      else $unset["optionality"] = "";
    }
    if (body.sources) {
      if (Array.isArray(body.sources.repos)) {
        $set["sources.repos"] = body.sources.repos.map((r) => r.trim()).filter(Boolean);
      }
      if (typeof body.sources.confluence_url === "string") {
        $set["sources.confluence_url"] = body.sources.confluence_url.trim();
      }
      if ("confluence_page_scopes" in body.sources) {
        const pageScopes = normalizeConfluencePageScopes(
          body.sources.confluence_page_scopes,
        );
        if (pageScopes.length) {
          $set["sources.confluence_page_scopes"] = pageScopes;
          $unset["sources.confluence_page_scope"] = "";
        } else {
          $unset["sources.confluence_page_scopes"] = "";
        }
      }
      if ("confluence_page_scope" in body.sources) {
        const pageScope = normalizeConfluencePageScope(
          body.sources.confluence_page_scope,
        );
        if (pageScope) $set["sources.confluence_page_scope"] = pageScope;
        else $unset["sources.confluence_page_scope"] = "";
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

    const accessChanged = [
      "team_id",
      "team_slug",
      "team_name",
      "labels.initiatives",
      "labels.areas",
    ].some((key) => key in $set);
    const accessProjection: ProjectDocument = {
      ...project,
      team_id: (typeof $set.team_id === "string" ? $set.team_id : project.team_id),
      team_slug: (typeof $set.team_slug === "string" ? $set.team_slug : project.team_slug),
      team_name: (typeof $set.team_name === "string" ? $set.team_name : project.team_name),
      labels: {
        ...project.labels,
        ...("labels.initiatives" in $set
          ? { initiatives: $set["labels.initiatives"] as string[] }
          : {}),
        ...("labels.areas" in $set
          ? { areas: $set["labels.areas"] as string[] }
          : {}),
      },
    };
    if (accessChanged) {
      await reconcileTomeReadAccess(accessProjection);
    }

    try {
      if (nextDataSteward) {
        await reconcileDataSteward(project, nextDataSteward);
      }
      await projects.updateOne(
        { _id: project._id },
        Object.keys($unset).length > 0 ? { $set, $unset } : { $set },
      );
      invalidateTomeReadAccessCatalogCache();
    } catch (error) {
      if (accessChanged) {
        await reconcileTomeReadAccess(project).catch((rollbackError) => {
          console.error("[tome] failed to roll back read-access projection", rollbackError);
        });
      }
      if (nextDataSteward) {
        const previousSteward = await resolveDataSteward(project.data_steward).catch(() => null);
        await reconcileDataSteward(
          { ...project, data_steward: nextDataSteward },
          previousSteward,
        ).catch((rollbackError) => {
          console.error("[tome] failed to roll back data-steward projection", rollbackError);
        });
      }
      throw error;
    }

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
      "labels.areas",
      "team_id",
    ].some((k) => k in $set);
    if (metaChanged) {
      auditTome({ action: "tome.project.update", actor, projectSlug: slug });
    }
    if (body.sources) {
      auditSourceChanges(slug, actor, project.sources, updated.sources);
    }

    const updatedReadConfiguration = await getTomeReadConfiguration(updated);
    const updatedSteward = await resolveDataSteward(updated.data_steward).catch(() => null);
    return successResponse({
      project: { ...updated, _id: String(updated._id) },
      rbac: {
        ...updatedReadConfiguration,
        dataSteward: updatedSteward
          ? {
              type: updatedSteward.type,
              name: updatedSteward.name,
              subject: dataStewardOpenFgaSubject(updatedSteward),
              relation: "writer",
            }
          : null,
        tomeAdminOverride: "admin_surface:tome#can_manage",
      },
      external: externalUpdates,
    });
  },
);
