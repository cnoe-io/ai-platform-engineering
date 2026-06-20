import { ApiError } from "@/lib/api-middleware";
import { authOptions,isBootstrapAdmin } from "@/lib/auth-config";
import { getConfig } from "@/lib/config";
import { getCollection } from "@/lib/mongodb";
import { parseAdminSimulation } from "@/lib/rbac/admin-simulator";
import {
adminSurfaceObject,
BASELINE_ADMIN_SURFACES,
baselineBootstrapTuples,
getBaselineFgaProfile,
} from "@/lib/rbac/baseline-access";
import { checkOpenFgaTuple,listOpenFgaObjects,writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { openFgaResourceObject } from "@/lib/rbac/openfga-resource-ids";
import { organizationObjectId } from "@/lib/rbac/organization";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";
import type { AdminTabGatesMap,AdminTabKey } from "@/lib/rbac/types";
import { webexSpaceSubjectId } from "@/lib/rbac/webex-space-grant-store";
import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ALL_TABS: AdminTabKey[] = [
  "users",
  "teams",
  "roles",
  "identity_group_sync",
  "slack",
  "webex",
  "skills",
  "feedback",
  "stats",
  "metrics",
  "health",
  "credentials",
  "audit_logs",
  "dynamic_agent_conversations",
  "action_audit",
  "openfga",
  "migrations",
  "service_accounts",
];

const DYNAMIC_AGENT_CONVERSATIONS_AUDIT_ID = "dynamic_agent_conversations";

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
  audit_logs: "auditLogsEnabled",
  action_audit: "actionAuditEnabled",
  credentials: "credentialsEnabled",
};

const BASELINE_TABS = new Set<AdminTabKey>(BASELINE_ADMIN_SURFACES);

const TAB_ADMIN_SURFACES: Partial<Record<AdminTabKey, string>> = {
  roles: "roles",
  identity_group_sync: "identity_group_sync",
  slack: "slack",
  webex: "webex",
  feedback: "feedback",
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

async function hasAdminSurfaceManage(openfgaUser: string, tab: AdminTabKey): Promise<boolean> {
  const surface = TAB_ADMIN_SURFACES[tab];
  if (!surface) return false;
  return checkTupleAllowed({
    user: openfgaUser,
    relation: "can_manage",
    object: adminSurfaceObject(surface),
  });
}

async function hasDynamicAgentConversationsRead(openfgaUser: string): Promise<boolean> {
  // assisted-by Codex Codex-sonnet-4-6
  // Mirrors /api/dynamic-agents/conversations, which gates this surface on
  // audit_log:dynamic_agent_conversations#can_read with org-admin bypass.
  return checkTupleAllowed({
    user: openfgaUser,
    relation: "can_read",
    object: openFgaResourceObject("audit_log", DYNAMIC_AGENT_CONVERSATIONS_AUDIT_ID),
  });
}

async function hasBaselineAdminSurfaceRead(openfgaUser: string, tab: AdminTabKey): Promise<boolean> {
  if (!BASELINE_TABS.has(tab)) return false;
  return checkTupleAllowed({
    user: openfgaUser,
    relation: "can_read",
    object: adminSurfaceObject(tab),
  });
}

interface SlackChannelMapping {
  slack_workspace_id?: string;
  slack_channel_id?: string;
  active?: boolean;
}

interface WebexSpaceMapping {
  webex_workspace_id?: string;
  webex_space_id?: string;
  active?: boolean;
}

async function repairCurrentUserBaseline(subject: string, isAdmin: boolean): Promise<void> {
  try {
    const profile = await getBaselineFgaProfile();
    await writeOpenFgaTuples({
      writes: baselineBootstrapTuples(subject, isAdmin, profile),
      deletes: [],
    });
  } catch {
    // Gate evaluation remains fail-closed if the OpenFGA repair path is unavailable.
  }
}

async function hasAccessibleSlackChannel(openfgaUser: string): Promise<boolean> {
  try {
    const mappings = await getCollection<SlackChannelMapping>("channel_team_mappings");
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .limit(500)
      .toArray();

    for (const row of rows) {
      if (!row.slack_channel_id) continue;
      const object = `slack_channel:${slackChannelSubjectId(row.slack_workspace_id ?? "", row.slack_channel_id)}`;
      // assisted-by Codex Codex-sonnet-4-6
      // Team-shared Slack channels should reveal the self-service integration
      // surface for readers too; row edit controls still depend on can_manage.
      const [readable, manageable] = await Promise.all([
        checkTupleAllowed({ user: openfgaUser, relation: "can_read", object }),
        checkTupleAllowed({ user: openfgaUser, relation: "can_manage", object }),
      ]);
      if (readable || manageable) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function hasAccessibleWebexSpace(openfgaUser: string): Promise<boolean> {
  try {
    const mappings = await getCollection<WebexSpaceMapping>("webex_space_team_mappings");
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .limit(500)
      .toArray();

    for (const row of rows) {
      if (!row.webex_space_id) continue;
      const object = `webex_space:${webexSpaceSubjectId(row.webex_workspace_id ?? "", row.webex_space_id)}`;
      const [readable, manageable] = await Promise.all([
        checkTupleAllowed({ user: openfgaUser, relation: "can_read", object }),
        checkTupleAllowed({ user: openfgaUser, relation: "can_manage", object }),
      ]);
      if (readable || manageable) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * The Service Accounts tab is self-service for ANY team member (not admin-only)
 * — see research.md R-7 (T001). Visibility keys on "belongs to ≥1 team", mirroring
 * the non-admin, resource-scoped Slack/Webex gates. The real control is per-action
 * owning-team authorization on every BFF route. Fail-closed on error.
 */
async function isMemberOfAnyTeam(openfgaUser: string): Promise<boolean> {
  try {
    const result = await listOpenFgaObjects({
      user: openfgaUser,
      relation: "member",
      type: "team",
    });
    return result.objects.length > 0;
  } catch {
    return false;
  }
}

async function hasResourceScopedIntegrationAccess(openfgaUser: string, tab: AdminTabKey): Promise<boolean> {
  if (tab === "slack") return hasAccessibleSlackChannel(openfgaUser);
  if (tab === "webex") return hasAccessibleWebexSpace(openfgaUser);
  if (tab === "service_accounts") return isMemberOfAnyTeam(openfgaUser);
  return false;
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
  const currentSubject = getSessionSubject(session);
  const currentUser = currentSubject ? `user:${currentSubject}` : undefined;
  const bootstrapAdmin = isBootstrapAdmin(session.user.email ?? "");
  if (currentSubject && !simulatedUser) {
    await repairCurrentUserBaseline(currentSubject, isAdmin);
  }

  const gates: AdminTabGatesMap = {} as AdminTabGatesMap;
  for (const tab of ALL_TABS) {
    const actor = simulatedUser ?? currentUser;
    let allowed: boolean;
    if (tab === "dynamic_agent_conversations") {
      if (simulatedUser) {
        const simulatedOrgAdmin = await checkTupleAllowed({
          user: simulatedUser,
          relation: "can_manage",
          object: organizationObjectId(),
        });
        allowed = simulatedOrgAdmin || await hasDynamicAgentConversationsRead(simulatedUser);
      } else {
        allowed = isAdmin || (actor ? await hasDynamicAgentConversationsRead(actor) : false);
      }
    } else {
      allowed =
        tab === "credentials"
          ? simulatedUser
            ? await checkTupleAllowed({
                user: simulatedUser,
                relation: "can_manage",
                object: organizationObjectId(),
              })
            : isAdmin
          : BASELINE_TABS.has(tab) && actor
            ? await hasBaselineAdminSurfaceRead(actor, tab)
            : simulatedUser
              ? await hasAdminSurfaceManage(simulatedUser, tab)
              : bootstrapAdmin || (actor ? await hasAdminSurfaceManage(actor, tab) : false);
    }
    if (!allowed && actor && !simulatedUser) {
      allowed = await hasResourceScopedIntegrationAccess(actor, tab);
    }

    const flagKey = TAB_FEATURE_FLAGS[tab];
    if (flagKey && allowed) {
      allowed = !!getConfig(flagKey as Parameters<typeof getConfig>[0]);
    }

    gates[tab] = allowed;
  }

  return NextResponse.json({ gates, simulation });
}
