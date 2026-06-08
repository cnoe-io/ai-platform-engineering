import { type NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withErrorHandler,
  successResponse,
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";
import { getRealmUserById } from "@/lib/rbac/keycloak-admin";
import {
  upsertTeamMembershipSource,
  markTeamMembershipSourceRemoved,
  listActiveTeamMembershipSourcesForTeamUser,
} from "@/lib/rbac/team-membership-source-store";
import {
  resolveKeycloakUserSubject,
  writeTeamMembershipTuples,
} from "@/lib/rbac/team-membership-sync";
import { findUserRoleInTeam } from "@/lib/rbac/team-membership-store";
import type { TeamMembershipSource } from "@/types/identity-group-sync";

function requireMongoDB(): NextResponse | null {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured — team membership requires MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }
  return null;
}

interface TeamDoc {
  _id: unknown;
  slug?: string;
  name?: string;
}

async function findTeamBySlugOrName(teamId: string): Promise<TeamDoc | null> {
  const col = await getCollection<TeamDoc>("teams");
  return col.findOne({ $or: [{ slug: teamId }, { name: teamId }] });
}

function manualSource(input: {
  teamId: string;
  teamSlug: string;
  email: string;
  relationship: "member" | "admin";
  actor: string;
  now: Date;
  userSubject?: string;
}): TeamMembershipSource {
  const ts = input.now.toISOString();
  return {
    team_id: input.teamId,
    team_slug: input.teamSlug,
    user_subject: input.userSubject,
    user_email: input.email,
    relationship: input.relationship,
    source_type: "manual",
    managed: false,
    status: "active",
    first_seen_at: ts,
    last_seen_at: ts,
    last_applied_at: ts,
    created_by: input.actor,
    created_at: ts,
  };
}

export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

    const params = await context.params;
    const userId = params.id;

    let body: { teamId?: string };
    try {
      body = (await request.json()) as { teamId?: string };
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const teamSlugOrName = typeof body.teamId === "string" ? body.teamId.trim() : "";
    if (!teamSlugOrName) {
      throw new ApiError("teamId is required", 400);
    }

    const [kcUser, team] = await Promise.all([
      getRealmUserById(userId),
      findTeamBySlugOrName(teamSlugOrName),
    ]);

    const email = String(kcUser.email ?? "").trim().toLowerCase();
    if (!email) {
      throw new ApiError("User has no email — cannot add to team", 400);
    }
    if (!team) {
      throw new ApiError(`Team not found: ${teamSlugOrName}`, 404);
    }

    const teamSlug = String(team.slug ?? "").trim();
    const teamId = String(team._id);

    if (!teamSlug) {
      throw new ApiError("Team has no slug — cannot add member", 400);
    }

    const existing = await findUserRoleInTeam(teamSlug, { user_email: email });
    if (existing !== null) {
      throw new ApiError("User is already a member of this team", 400);
    }

    const now = new Date();
    const actor = session?.user?.email ?? "admin";
    const keycloakSubject = await resolveKeycloakUserSubject(email, teamSlug);

    await writeTeamMembershipTuples(keycloakSubject, teamSlug, ["member"], "assign");
    await upsertTeamMembershipSource(
      manualSource({ teamId, teamSlug, email, relationship: "member", actor, now, userSubject: keycloakSubject })
    );

    return successResponse({ ok: true }, 200);
  }
);

export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

    const params = await context.params;
    const userId = params.id;

    let body: { teamId?: string };
    try {
      body = (await request.json()) as { teamId?: string };
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const teamSlugOrName = typeof body.teamId === "string" ? body.teamId.trim() : "";
    if (!teamSlugOrName) {
      throw new ApiError("teamId is required", 400);
    }

    const [kcUser, team] = await Promise.all([
      getRealmUserById(userId),
      findTeamBySlugOrName(teamSlugOrName),
    ]);

    const email = String(kcUser.email ?? "").trim().toLowerCase();
    if (!email) {
      throw new ApiError("User has no email", 400);
    }
    if (!team) {
      throw new ApiError(`Team not found: ${teamSlugOrName}`, 404);
    }

    const teamSlug = String(team.slug ?? "").trim();
    const teamId = String(team._id);

    if (!teamSlug) {
      throw new ApiError("Team has no slug", 400);
    }

    const canonicalRole = await findUserRoleInTeam(teamSlug, { user_email: email });
    if (canonicalRole === null) {
      throw new ApiError("User is not a member of this team", 404);
    }

    const now = new Date();
    const actor = session?.user?.email ?? "admin";
    const keycloakSubject = await resolveKeycloakUserSubject(email, teamSlug);

    await markTeamMembershipSourceRemoved(
      manualSource({ teamId, teamSlug, email, relationship: canonicalRole, actor, now, userSubject: keycloakSubject }),
      actor,
      now.toISOString()
    );

    const otherSources = await listActiveTeamMembershipSourcesForTeamUser({
      teamId,
      teamSlug,
      userSubject: keycloakSubject,
      userEmail: email,
    });
    if (otherSources.length === 0) {
      await writeTeamMembershipTuples(keycloakSubject, teamSlug, [canonicalRole], "remove");
    }

    return successResponse({ ok: true });
  }
);
