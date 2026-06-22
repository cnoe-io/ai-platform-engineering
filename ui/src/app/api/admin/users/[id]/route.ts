import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import {
getRealmUserById,
getUserFederatedIdentities,
getUserSessions,
listRealmRoleMappingsForUser,
updateUser,
} from "@/lib/rbac/keycloak-admin";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { requireUserProfileRead } from "@/lib/rbac/require-openfga";
import type { TeamMembershipSource } from "@/types/identity-group-sync";
import { type NextRequest } from "next/server";

function normalizeAttributes(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.map(String);
    else if (v != null) out[k] = [String(v)];
  }
  return out;
}

function slackLinkStatus(attrs: Record<string, string[]>): "linked" | "unlinked" {
  const sid = attrs.slack_user_id?.[0];
  return sid && String(sid).trim() !== "" ? "linked" : "unlinked";
}

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { session } = await getAuthFromBearerOrSession(request);
    const params = await context.params;
    const id = params.id;
    await requireUserProfileRead(session, id);

    const [kcUser, realmRoles, sessions, federatedIdentities] = await Promise.all([
      getRealmUserById(id),
      listRealmRoleMappingsForUser(id),
      getUserSessions(id),
      getUserFederatedIdentities(id),
    ]);

    const email = String(kcUser.email ?? "").trim().toLowerCase();
    const teams: Array<{ team_id: string; tenant_id: string }> = [];

    if (isMongoDBConfigured && email) {
      const sources = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
      const rows = await sources
        .find({ user_email: email, status: "active" })
        .project({ team_slug: 1, team_id: 1 })
        .toArray();
      // Deduplicate by team_slug — a user may have multiple source rows per team.
      const seen = new Set<string>();
      for (const row of rows) {
        const slug = row.team_slug;
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        teams.push({ team_id: slug, tenant_id: row.team_id ?? "" });
      }
    }

    const attributes = normalizeAttributes(kcUser.attributes);

    const lastAccess = sessions.reduce((max, s) => {
      const t = s.lastAccess ?? s.start ?? 0;
      return t > max ? t : max;
    }, 0);

    const createdRaw = kcUser.createdTimestamp;
    const createdAt =
      typeof createdRaw === "number" && createdRaw > 0 ? createdRaw : null;

    return successResponse({
      user: {
        id: String(kcUser.id ?? id),
        username: String(kcUser.username ?? ""),
        email: String(kcUser.email ?? ""),
        firstName:
          kcUser.firstName !== undefined && kcUser.firstName !== null
            ? String(kcUser.firstName)
            : "",
        lastName:
          kcUser.lastName !== undefined && kcUser.lastName !== null
            ? String(kcUser.lastName)
            : "",
        enabled: kcUser.enabled !== false,
        createdAt,
        attributes,
        slackLinkStatus: slackLinkStatus(attributes),
        realmRoles: realmRoles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
        })),
        sessions,
        federatedIdentities,
        teams: teams.map((t) => ({
          team_id: t.team_id,
          tenant_id: t.tenant_id,
        })),
        lastAccess: lastAccess > 0 ? lastAccess : null,
      },
    });
  }
);

export const PUT = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

    const params = await context.params;
    const id = params.id;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const existing = await getRealmUserById(id);
    const merged: Record<string, unknown> = { ...existing, ...body, id: existing.id };
    await updateUser(id, merged);

    return successResponse({ ok: true });
  }
);
