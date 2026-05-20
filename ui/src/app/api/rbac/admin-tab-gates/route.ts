import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isBootstrapAdmin } from "@/lib/auth-config";
import { ApiError } from "@/lib/api-middleware";
import { getConfig } from "@/lib/config";
import { parseAdminSimulation } from "@/lib/rbac/admin-simulator";
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

const BASELINE_TABS = new Set<AdminTabKey>(["users", "teams", "skills", "metrics", "health"]);

const TAB_ADMIN_SURFACES: Partial<Record<AdminTabKey, string>> = {
  roles: "roles",
  identity_group_sync: "identity_group_sync",
  slack: "slack",
  webex: "webex",
  feedback: "feedback",
  nps: "nps",
  stats: "stats",
  audit_logs: "audit_logs",
  action_audit: "action_audit",
  openfga: "openfga",
  migrations: "migrations",
};

async function checkTupleAllowed(tuple: { user: string; relation: string; object: string }): Promise<boolean> {
  try {
    const result = await checkOpenFgaTuple(tuple);
    return result.allowed;
  } catch {
    return false;
  }
}

async function hasSimulatedOrganizationAdmin(openfgaUser: string): Promise<boolean> {
  return checkTupleAllowed({
    user: openfgaUser,
    relation: "can_manage",
    object: organizationObjectId(),
  });
}

async function hasSimulatedAdminSurface(openfgaUser: string, tab: AdminTabKey): Promise<boolean> {
  const surface = TAB_ADMIN_SURFACES[tab];
  if (!surface) return false;
  return checkTupleAllowed({
    user: openfgaUser,
    relation: "can_manage",
    object: `admin_surface:${surface}`,
  });
}

/**
 * GET /api/rbac/admin-tab-gates
 *
 * Returns a map of { tab_key: boolean } indicating which admin tabs the
 * current user may see. This endpoint intentionally does not read CEL policy
 * storage; tab visibility follows the organization-level OpenFGA admin
 * relationship plus the bootstrap-admin break-glass fallback.
 */
export async function GET(request?: NextRequest) {
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
  let simulation;
  try {
    const searchParams = request ? new URL(request.url).searchParams : new URLSearchParams();
    simulation = parseAdminSimulation(searchParams);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  if (simulation.active && !isAdmin) {
    return NextResponse.json(
      { error: "Simulation requires organization admin access" },
      { status: 403 }
    );
  }
  const simulatedUser = simulation.subject?.openfga_user;
  const simulatedOrgAdmin = simulatedUser
    ? await hasSimulatedOrganizationAdmin(simulatedUser)
    : false;

  const gates: AdminTabGatesMap = {} as AdminTabGatesMap;
  for (const tab of ALL_TABS) {
    let allowed = BASELINE_TABS.has(tab)
      ? true
      : simulatedUser
        ? simulatedOrgAdmin || await hasSimulatedAdminSurface(simulatedUser, tab)
        : isAdmin;

    const flagKey = TAB_FEATURE_FLAGS[tab];
    if (flagKey && allowed) {
      allowed = !!getConfig(flagKey as Parameters<typeof getConfig>[0]);
    }

    gates[tab] = allowed;
  }

  return NextResponse.json({ gates, simulation });
}
