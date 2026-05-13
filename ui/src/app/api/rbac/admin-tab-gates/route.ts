import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isBootstrapAdmin } from "@/lib/auth-config";
import { getConfig } from "@/lib/config";
import type { AdminTabKey, AdminTabGatesMap } from "@/lib/rbac/types";

const ALL_TABS: AdminTabKey[] = [
  "users",
  "teams",
  "roles",
  "identity_group_sync",
  "slack",
  "skills",
  "feedback",
  "nps",
  "stats",
  "metrics",
  "health",
  "audit_logs",
  "action_audit",
  "openfga",
];

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

function getSessionRoles(session: {
  accessToken?: string;
  realmRoles?: string[];
  role?: string;
  user?: { email?: string | null };
}): string[] {
  const payload = session.accessToken
    ? decodeJwtPayload(session.accessToken)
    : {};
  const ra = (payload.realm_access as { roles?: string[] } | undefined)?.roles;
  const roles: string[] = Array.isArray(ra) ? [...ra] : [];
  if (Array.isArray(session.realmRoles)) {
    for (const r of session.realmRoles) {
      if (!roles.includes(r)) roles.push(r);
    }
  }

  const email = String(
    session.user?.email ??
      payload.email ??
      payload.preferred_username ??
      ""
  );

  // Bootstrap admins and users with session.role === 'admin' must satisfy
  // admin-gated tabs even when the session lacks a fresh realm role claim.
  if (!roles.includes("admin")) {
    if (session.role === "admin" || isBootstrapAdmin(email)) {
      roles.push("admin");
    }
  }
  return roles;
}

/**
 * Feature-flag conjunctions: even if RBAC allows a tab, the corresponding
 * feature flag must also be enabled for these tabs.
 */
const TAB_FEATURE_FLAGS: Partial<Record<AdminTabKey, string>> = {
  feedback: "feedbackEnabled",
  nps: "npsEnabled",
  audit_logs: "auditLogsEnabled",
  action_audit: "actionAuditEnabled",
};

/**
 * GET /api/rbac/admin-tab-gates
 *
 * Returns a map of { tab_key: boolean } indicating which admin tabs the
 * current user may see. This endpoint intentionally does not read CEL policy
 * storage; tab visibility is deterministic RBAC-era plumbing while resource
 * authorization lives in OpenFGA/Keycloak PDP checks.
 */
export async function GET() {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    realmRoles?: string[];
    role?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = getSessionRoles(session);
  const isAdmin = roles.includes("admin") || roles.includes("admin_user");

  const gates: AdminTabGatesMap = {} as AdminTabGatesMap;
  for (const tab of ALL_TABS) {
    let allowed =
      tab === "users" ||
      tab === "teams" ||
      tab === "skills" ||
      tab === "metrics" ||
      tab === "health"
        ? true
        : isAdmin;

    const flagKey = TAB_FEATURE_FLAGS[tab];
    if (flagKey && allowed) {
      allowed = !!getConfig(flagKey as Parameters<typeof getConfig>[0]);
    }

    gates[tab] = allowed;
  }

  return NextResponse.json({ gates });
}
