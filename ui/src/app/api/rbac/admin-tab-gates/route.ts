import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isBootstrapAdmin } from "@/lib/auth-config";
import { getConfig } from "@/lib/config";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";
import type { AdminTabKey, AdminTabGatesMap } from "@/lib/rbac/types";

const ALL_TABS: AdminTabKey[] = [
  "users",
  "teams",
  "roles",
  "identity_group_sync",
  "slack",
  "webex",
  "skills",
  "feedback",
  "nps",
  "stats",
  "metrics",
  "health",
  "audit_logs",
  "action_audit",
  "openfga",
  "migrations",
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

function getSessionSubject(session: {
  accessToken?: string;
  sub?: string;
}): string | undefined {
  if (session.sub) return session.sub;
  const payload = session.accessToken ? decodeJwtPayload(session.accessToken) : {};
  return typeof payload.sub === "string" ? payload.sub : undefined;
}

async function hasOrganizationAdmin(session: {
  accessToken?: string;
  sub?: string;
  user?: { email?: string | null };
}): Promise<boolean> {
  const email = session.user?.email ?? "";
  if (isBootstrapAdmin(email)) return true;

  const subject = getSessionSubject(session);
  if (!subject) return false;

  try {
    const decision = await checkOpenFgaTuple({
      user: `user:${subject}`,
      relation: "can_manage",
      object: organizationObjectId(),
    });
    return decision.allowed;
  } catch {
    return false;
  }
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
 * storage; tab visibility follows the organization-level OpenFGA admin
 * relationship plus the bootstrap-admin break-glass fallback.
 */
export async function GET() {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    sub?: string;
    role?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await hasOrganizationAdmin(session);

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
