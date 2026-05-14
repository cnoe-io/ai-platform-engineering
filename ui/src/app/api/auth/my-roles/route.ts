import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getRealmUserById } from "@/lib/rbac/keycloak-admin";

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * GET /api/auth/my-roles
 *
 * Returns the authenticated user's RBAC posture:
 * - realm_roles: Keycloak realm roles from JWT
 * - teams: Team memberships from MongoDB
 * - per_kb_roles / per_agent_roles: retained for response compatibility,
 *   but new resource grants live in OpenFGA and are not surfaced from JWT roles
 * - idp_source: Identity provider (from JWT azp/iss)
 * - slack_linked: Whether the user has a linked Slack account
 */
const RESOURCE_ROLE_PREFIXES = [
  "kb_reader:",
  "kb_ingestor:",
  "kb_admin:",
  "agent_user:",
  "agent_admin:",
  "tool_user:",
  "task_user:",
  "task_admin:",
  "skill_user:",
  "skill_admin:",
] as const;

function isResourceRole(role: string): boolean {
  return RESOURCE_ROLE_PREFIXES.some((prefix) => role.startsWith(prefix));
}

export async function GET() {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    realmRoles?: string[];
    user?: { email?: string | null; name?: string | null };
    role?: string;
  } | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email;

  const payload = session.accessToken
    ? decodeJwtPayload(session.accessToken)
    : {};

  const ra = (payload.realm_access as { roles?: string[] } | undefined)?.roles;
  const realmRoles: string[] = Array.isArray(ra) ? [...ra] : [];
  if (Array.isArray(session.realmRoles)) {
    for (const r of session.realmRoles) {
      if (!realmRoles.includes(r)) realmRoles.push(r);
    }
  }

  const hiddenResourceRoleCount = realmRoles.filter(isResourceRole).length;
  const baseRoles = realmRoles.filter((r) => !isResourceRole(r));

  const idpSource = (payload.azp as string) || (payload.iss as string) || "unknown";

  let teams: Array<{ _id: string; name: string; role?: string }> = [];
  let slackLinked = false;

  if (isMongoDBConfigured) {
    try {
      const teamsCol = await getCollection("teams");
      const userTeams = await teamsCol
        .find({ "members.user_id": email })
        .project({ _id: 1, name: 1, members: 1 })
        .toArray();
      teams = userTeams.map((t) => {
        const member = (t.members as Array<{ user_id: string; role?: string }>)?.find(
          (m) => m.user_id === email
        );
        return {
          _id: t._id.toString(),
          name: t.name as string,
          role: member?.role,
        };
      });
    } catch {
      // MongoDB may not be available
    }

    try {
      const sub = (session as { sub?: string }).sub;
      if (sub) {
        const kcUser = await getRealmUserById(sub);
        const attrs = kcUser.attributes as Record<string, string[]> | undefined;
        slackLinked = !!(attrs?.slack_user_id?.[0]?.trim());
      }
    } catch {
      // Keycloak may not be available
    }
  }

  return NextResponse.json({
    email,
    name: session.user.name,
    role: session.role ?? "user",
    realm_roles: baseRoles,
    per_kb_roles: [],
    per_agent_roles: [],
    legacy_resource_roles_hidden_count: hiddenResourceRoleCount,
    teams,
    idp_source: idpSource,
    slack_linked: slackLinked,
  });
}
