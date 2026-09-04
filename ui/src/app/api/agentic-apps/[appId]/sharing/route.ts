import { NextRequest } from "next/server";

import { reconcileTupleDiff } from "@/lib/authz/reconcile";
import { ApiError } from "@/lib/api-error";
import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  buildAgenticAppSharingTupleDiff,
  effectiveAgenticAppTeamAccess,
  effectiveAgenticAppVisibility,
} from "@/lib/agentic-apps/sharing";
import { resolveAgenticAppCasMode } from "@/lib/agentic-apps/cas-compat";
import {
  getConfiguredAgenticApp,
  isAgenticAppsEnabled,
} from "@/lib/agentic-apps/config";
import {
  appendAgenticAppEvent,
  installAppPackage,
  listAppInstallations,
  updateAppInstallationSharing,
} from "@/lib/agentic-apps/store";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { subjectFromSession } from "@/lib/rbac/resource-authz";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";
import { buildTeamRefToSlugMap } from "@/lib/rbac/workflow-config-rebac";
import type {
  AgenticAppTeamAccessGrant,
  AgenticAppTeamRole,
  AgenticAppVisibility,
} from "@/types/agentic-app";

interface SharingContext {
  params: Promise<{ appId: string }>;
}

export const GET = withErrorHandler(
  async (request: NextRequest, context: SharingContext) => {
    const { user, session } = await getAuthFromBearerOrSession(request);
    const { installation } = await loadInstallation((await context.params).appId);
    await requireResourcePermission(session, {
      type: "agentic_app",
      id: installation.appId,
      action: "read",
    });

    const teamAccess = effectiveAgenticAppTeamAccess(installation);
    const effectivePermissions = await loadEffectivePermissions(session, installation.appId);
    const accessReasons = await loadAccessReasons(session, installation, teamAccess);

    return successResponse({
      appId: installation.appId,
      visibility: effectiveAgenticAppVisibility(installation),
      sharedWithTeams: installation.sharedWithTeams ?? [],
      teamAccess,
      createdBy: installation.createdBy ?? "system",
      canManage: effectivePermissions.admin,
      effectivePermissions,
      accessReasons,
      enforcement: {
        casMode: resolveAgenticAppCasMode(),
        openFga: "enforced",
      },
      viewer: user.email,
    });
  },
);

export const PUT = withErrorHandler(
  async (request: NextRequest, context: SharingContext) => {
    const { user, session } = await getAuthFromBearerOrSession(request);
    const { installation, persisted } = await loadInstallation((await context.params).appId);
    await requireResourcePermission(session, {
      type: "agentic_app",
      id: installation.appId,
      action: "manage",
    });

    const body = await readBody(request);
    const visibility = parseVisibility(body.visibility);
    const teamAccess = await parseTeamAccess(visibility, body.teamAccess);
    const sharedWithTeams = teamAccess.map((grant) => grant.teamSlug);
    const subject = typeof session.sub === "string" ? session.sub.trim() : "";
    if (!subject) {
      throw new ApiError("A stable user subject is required", 401, "NO_SUBJECT");
    }
    const ownerSubject = installation.ownerSubject?.trim() || subject;
    const creatorSubject = installation.creatorSubject?.trim() || subject;
    const createdBy = installation.createdBy?.trim() || user.email;

    if (!persisted) {
      await installAppPackage({
        appId: installation.appId,
        packageId: installation.packageId,
        installed: true,
        enabled: true,
        visible: true,
        createdBy,
        creatorSubject,
        ownerSubject,
        visibility: effectiveAgenticAppVisibility(installation),
        sharedWithTeams: installation.sharedWithTeams ?? [],
        teamAccess: effectiveAgenticAppTeamAccess(installation),
        updatedBy: user.email,
      });
    }

    await reconcileTupleDiff(
      buildAgenticAppSharingTupleDiff({
        appId: installation.appId,
        ownerSubject,
        visibility,
        sharedWithTeams,
        teamAccess,
        previousVisibility: effectiveAgenticAppVisibility(installation),
        previousSharedWithTeams: installation.sharedWithTeams,
        previousTeamAccess: effectiveAgenticAppTeamAccess(installation),
      }),
      {
        caller: { type: "user", id: subject },
        source: "agentic_app_sharing",
      },
    );
    await updateAppInstallationSharing({
      appId: installation.appId,
      visibility,
      sharedWithTeams,
      teamAccess,
      ownerSubject,
      creatorSubject,
      createdBy,
      updatedBy: user.email,
    });
    await appendAgenticAppEvent({
      type: "agentic_app_sharing_updated",
      actorEmail: user.email,
      appId: installation.appId,
      packageId: installation.packageId,
      payload: { visibility, teamAccess },
    });

    return successResponse({
      appId: installation.appId,
      visibility,
      sharedWithTeams,
      teamAccess,
      createdBy,
      canManage: true,
    });
  },
);

async function loadInstallation(appId: string): Promise<{
  installation: Awaited<ReturnType<typeof listAppInstallations>>[number];
  persisted: boolean;
}> {
  const configured = isAgenticAppsEnabled() ? getConfiguredAgenticApp(appId) : null;
  if (!configured) {
    throw new ApiError("Agentic app not found", 404);
  }
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required for Agentic Apps", 503);
  }
  const installation = (await listAppInstallations()).find(
    (candidate) => candidate.appId === appId && candidate.installed,
  );
  if (installation) return { installation, persisted: true };

  return {
    installation: {
      appId,
      packageId: configured.installation.packageId,
      installed: configured.installation.installed,
      enabled: configured.installation.enabled,
      visible: configured.installation.visible,
      createdBy: "seed-config",
      visibility: "global",
      sharedWithTeams: [],
      teamAccess: [],
    },
    persisted: false,
  };
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
}

function parseVisibility(value: unknown): AgenticAppVisibility {
  if (value === "private" || value === "team" || value === "global") return value;
  throw new ApiError("visibility must be private, team, or global", 400);
}

async function parseTeamAccess(
  visibility: AgenticAppVisibility,
  value: unknown,
): Promise<AgenticAppTeamAccessGrant[]> {
  if (value !== undefined && !Array.isArray(value)) {
    throw new ApiError("teamAccess must be an array", 400);
  }
  if (visibility === "private") return [];
  const rows = ((value as unknown[] | undefined) ?? []).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new ApiError("Each team access row must be an object", 400);
    }
    const record = row as Record<string, unknown>;
    const teamRef = typeof record.teamSlug === "string" ? record.teamSlug.trim() : "";
    const role = record.role;
    if (!teamRef || !isTeamRole(role)) {
      throw new ApiError("Each team access row requires a valid teamSlug and role", 400);
    }
    return { teamRef, role };
  });
  const map = await buildTeamRefToSlugMap();
  const grants = rows.map(({ teamRef, role }) => ({
    teamSlug: map.get(teamRef) ?? map.get(teamRef.toLowerCase()) ?? "",
    role,
  }));
  if (grants.some((grant) => !grant.teamSlug)) {
    throw new ApiError("Select valid teams", 400);
  }
  if (new Set(grants.map((grant) => grant.teamSlug)).size !== grants.length) {
    throw new ApiError("A team may have only one access role", 400);
  }
  if (visibility === "team" && grants.length === 0) {
    throw new ApiError("Select one or more teams", 400);
  }
  return grants;
}

function isTeamRole(value: unknown): value is AgenticAppTeamRole {
  return value === "viewer" || value === "editor" || value === "approver" || value === "admin";
}

async function loadEffectivePermissions(
  session: Parameters<typeof requireResourcePermission>[0],
  appId: string,
): Promise<{ view: boolean; edit: boolean; approve: boolean; admin: boolean }> {
  const check = async (action: "use" | "write" | "approve" | "manage"): Promise<boolean> => {
    try {
      await requireResourcePermission(session, { type: "agentic_app", id: appId, action });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 403) return false;
      throw error;
    }
  };
  const [view, edit, approve, admin] = await Promise.all([
    check("use"),
    check("write"),
    check("approve"),
    check("manage"),
  ]);
  return { view, edit, approve, admin };
}

async function loadAccessReasons(
  session: Parameters<typeof requireResourcePermission>[0],
  installation: Awaited<ReturnType<typeof listAppInstallations>>[number],
  teamAccess: AgenticAppTeamAccessGrant[],
): Promise<Array<{ label: string; relationship: string }>> {
  const subject = subjectFromSession(session);
  if (!subject) return [];
  const reasons: Array<{ label: string; relationship: string }> = [];
  if (installation.ownerSubject && subject === `user:${installation.ownerSubject}`) {
    reasons.push({
      label: "You own this app",
      relationship: `${subject} owner agentic_app:${installation.appId}`,
    });
  }
  if (effectiveAgenticAppVisibility(installation) === "global") {
    reasons.push({
      label: "Available to every signed-in user",
      relationship: `user:* user agentic_app:${installation.appId}`,
    });
  }
  for (const grant of teamAccess) {
    const relation = grant.role === "admin" ? "admin" : "member";
    const result = await checkOpenFgaTuple({
      user: subject,
      relation,
      object: `team:${grant.teamSlug}`,
    }).catch(() => ({ allowed: false }));
    if (result.allowed) {
      const appRelation = grant.role === "viewer" ? "user" : grant.role === "editor" ? "writer" : grant.role === "approver" ? "approver" : "manager";
      reasons.push({
        label: `${grant.teamSlug} team · ${grant.role}`,
        relationship: `team:${grant.teamSlug}#${relation} ${appRelation} agentic_app:${installation.appId}`,
      });
    }
  }
  const orgAdmin = await checkOpenFgaTuple({
    user: subject,
    relation: "admin",
    object: organizationObjectId(),
  }).catch(() => ({ allowed: false }));
  if (orgAdmin.allowed) {
    reasons.push({
      label: "Organization administrator",
      relationship: `${subject} admin ${organizationObjectId()}`,
    });
  }
  return reasons;
}
