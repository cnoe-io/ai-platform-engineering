import { type NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withErrorHandler,
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";
import {
  searchRealmUsers,
  countRealmUsers,
  listUsersWithRole,
  listRealmRoleMappingsForUser,
  getUserFederatedIdentities,
} from "@/lib/rbac/keycloak-admin";
import {
  curateRealmRolesForUser,
  type RealmRoleClassification,
} from "@/lib/rbac/keycloak-transition";

type AdminUsersListItem = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  attributes: Record<string, string[]>;
  slack_link_status: "linked" | "pending" | "unlinked";
  roles: string[];
  raw_roles: string[];
  role_classifications: RealmRoleClassification[];
  hidden_role_count: number;
};

function parseBoolParam(v: string | null): boolean | undefined {
  if (v === null || v === "") return undefined;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw new ApiError('Invalid "enabled" value; use true or false', 400);
}

function normalizeAttributes(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.map(String);
    else if (v != null) out[k] = [String(v)];
  }
  return out;
}

function readSlackUserIdFromUser(u: Record<string, unknown>): string | undefined {
  const attrs = u.attributes as Record<string, unknown> | undefined;
  if (!attrs) return undefined;
  const sid = attrs.slack_user_id;
  const v = Array.isArray(sid) ? sid[0] : sid;
  const normalized = v != null ? String(v).trim() : "";
  return normalized || undefined;
}

async function loadPendingSlackIds(): Promise<Set<string>> {
  try {
    const nonceColl = await getCollection<{
      slack_user_id: string;
      expires_at?: Date;
      created_at?: Date;
      consumed?: boolean;
    }>("slack_link_nonces");
    const now = Date.now();
    const ttlMs = 10 * 60 * 1000;
    const rows = await nonceColl
      .find({
        consumed: { $ne: true },
        $or: [
          { expires_at: { $gt: new Date() } },
          { created_at: { $gte: new Date(now - ttlMs) } },
        ],
      })
      .project({ slack_user_id: 1 })
      .toArray();
    return new Set(rows.map((r) => String(r.slack_user_id).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function getSlackLinkStatus(
  u: Record<string, unknown>,
  pendingSlackIds: Set<string>
): AdminUsersListItem["slack_link_status"] {
  const slackUserId = readSlackUserIdFromUser(u);
  if (!slackUserId) return "unlinked";
  return pendingSlackIds.has(slackUserId) ? "pending" : "linked";
}

async function loadRoleUserIdSet(roleName: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let first = 0;
  const max = 100;
  for (;;) {
    const batch = await listUsersWithRole(roleName, first, max);
    if (batch.length === 0) break;
    for (const row of batch) {
      const id = row.id;
      if (id != null) ids.add(String(id));
    }
    first += batch.length;
  }
  return ids;
}

async function loadTeamMemberEmails(teamId: string): Promise<Set<string>> {
  const col = await getCollection<{ members?: string[] }>("team_kb_ownership");
  const docs = await col.find({ team_id: teamId }).toArray();
  const emails = new Set<string>();
  for (const d of docs) {
    for (const m of d.members ?? []) {
      emails.add(String(m).trim().toLowerCase());
    }
  }
  return emails;
}

async function enrichListRow(
  u: Record<string, unknown>,
  pendingSlackIds: Set<string>
): Promise<AdminUsersListItem> {
  const id = String(u.id ?? "");
  const roleRows = await listRealmRoleMappingsForUser(id);
  const curatedRoles = curateRealmRolesForUser(roleRows.map((r) => r.name));
  return {
    id,
    username: String(u.username ?? ""),
    email: String(u.email ?? ""),
    firstName:
      u.firstName !== undefined && u.firstName !== null ? String(u.firstName) : "",
    lastName: u.lastName !== undefined && u.lastName !== null ? String(u.lastName) : "",
    enabled: u.enabled !== false,
    attributes: normalizeAttributes(u.attributes),
    slack_link_status: getSlackLinkStatus(u, pendingSlackIds),
    ...curatedRoles,
  };
}

async function userMatchesFilters(
  u: Record<string, unknown>,
  opts: {
    roleIdSet: Set<string> | null;
    teamEmailSet: Set<string> | null;
    idp: string | null;
    slackStatus: AdminUsersListItem["slack_link_status"] | null;
    pendingSlackIds: Set<string>;
  }
): Promise<boolean> {
  const id = String(u.id ?? "");
  if (opts.roleIdSet && !opts.roleIdSet.has(id)) return false;

  const email = String(u.email ?? "").trim().toLowerCase();
  if (opts.teamEmailSet && !opts.teamEmailSet.has(email)) return false;

  if (opts.slackStatus && getSlackLinkStatus(u, opts.pendingSlackIds) !== opts.slackStatus) return false;

  if (opts.idp) {
    const feds = await getUserFederatedIdentities(id);
    const ok = feds.some((f) => f.identityProvider === opts.idp);
    if (!ok) return false;
  }

  return true;
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim() || undefined;
    const role = (url.searchParams.get("role") ?? "").trim() || undefined;
    const team = (url.searchParams.get("team") ?? "").trim() || undefined;
    const idp = (url.searchParams.get("idp") ?? "").trim() || undefined;
    const slackRaw = (url.searchParams.get("slackStatus") ?? "").trim().toLowerCase();
    const slackStatus =
      slackRaw === "linked" || slackRaw === "pending" || slackRaw === "unlinked"
        ? (slackRaw as AdminUsersListItem["slack_link_status"])
        : slackRaw === ""
          ? null
          : (() => {
              throw new ApiError('slackStatus must be "linked", "pending", or "unlinked"', 400);
            })();

    const enabled = parseBoolParam(url.searchParams.get("enabled"));

    let page = parseInt(url.searchParams.get("page") ?? "1", 10);
    let pageSize = parseInt(url.searchParams.get("pageSize") ?? "20", 10);
    if (Number.isNaN(page) || page < 1) {
      throw new ApiError("page must be >= 1", 400);
    }
    if (Number.isNaN(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ApiError("pageSize must be between 1 and 100", 400);
    }

    if (team && !isMongoDBConfigured) {
      return NextResponse.json(
        {
          error: "MongoDB not configured — team filter requires MongoDB",
          code: "MONGODB_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    const roleIdSet = role ? await loadRoleUserIdSet(role) : null;
    if (roleIdSet && roleIdSet.size === 0) {
      return NextResponse.json({
        users: [],
        total: 0,
        page,
        pageSize,
      });
    }

    const teamEmailSet =
      team && isMongoDBConfigured ? await loadTeamMemberEmails(team) : null;

    if (team && teamEmailSet && teamEmailSet.size === 0) {
      return NextResponse.json({
        users: [],
        total: 0,
        page,
        pageSize,
      });
    }

    const needsScan =
      Boolean(roleIdSet) ||
      Boolean(teamEmailSet) ||
      Boolean(idp) ||
      Boolean(slackStatus);
    const pendingSlackIds =
      needsScan || !slackStatus ? await loadPendingSlackIds() : new Set<string>();

    const skip = (page - 1) * pageSize;

    if (!needsScan) {
      const first = skip;
      const raw = await searchRealmUsers({
        search,
        enabled,
        first,
        max: pageSize,
      });
      const total = await countRealmUsers({ search, enabled });
      const users = await Promise.all(raw.map((row) => enrichListRow(row, pendingSlackIds)));
      return NextResponse.json({
        users,
        total,
        page,
        pageSize,
      });
    }

    const filterOpts = {
      roleIdSet,
      teamEmailSet,
      idp: idp ?? null,
      slackStatus,
      pendingSlackIds,
    };

    const pageRows: AdminUsersListItem[] = [];
    let matchCount = 0;
    let kcFirst = 0;
    const batchSize = 100;

    for (;;) {
      const batch = await searchRealmUsers({
        search,
        enabled,
        first: kcFirst,
        max: batchSize,
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        if (!(await userMatchesFilters(row, filterOpts))) continue;
        if (matchCount >= skip && pageRows.length < pageSize) {
        pageRows.push(await enrichListRow(row, pendingSlackIds));
        }
        matchCount += 1;
      }
      kcFirst += batch.length;
    }

    return NextResponse.json({
      users: pageRows,
      total: matchCount,
      page,
      pageSize,
    });
});
