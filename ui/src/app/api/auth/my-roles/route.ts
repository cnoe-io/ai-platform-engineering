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
 * - per_kb_roles: Per-KB roles (kb_reader:<id>, kb_admin:<id>)
 * - per_agent_roles: Per-agent roles (agent_user:<id>, agent_admin:<id>)
 * - idp_source: Identity provider (from JWT azp/iss)
 * - slack_linked: Whether the user has a linked Slack account
 */
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

  const perKbRoles: string[] = [];
  const perAgentRoles: string[] = [];
  for (const role of realmRoles) {
    if (role.startsWith("kb_reader:") || role.startsWith("kb_admin:")) {
      perKbRoles.push(role);
    } else if (role.startsWith("agent_user:") || role.startsWith("agent_admin:")) {
      perAgentRoles.push(role);
    }
  }

  const baseRoles = realmRoles.filter(
    (r) =>
      !r.startsWith("kb_reader:") &&
      !r.startsWith("kb_admin:") &&
      !r.startsWith("agent_user:") &&
      !r.startsWith("agent_admin:")
  );

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
    per_kb_roles: perKbRoles,
    per_agent_roles: perAgentRoles,
    teams,
    idp_source: idpSource,
    slack_linked: slackLinked,
  });
}
