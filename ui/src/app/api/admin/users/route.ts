import { type NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdminView,
  ApiError,
} from "@/lib/api-middleware";
import {
  searchRealmUsers,
  countRealmUsers,
  listUsersWithRole,
  listRealmRoleMappingsForUser,
  getUserFederatedIdentities,
} from "@/lib/rbac/keycloak-admin";

type AdminUsersListItem = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  attributes: Record<string, string[]>;
  roles: string[];
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

function isSlackLinkedFromUser(u: Record<string, unknown>): boolean {
  const attrs = u.attributes as Record<string, unknown> | undefined;
  if (!attrs) return false;
  const sid = attrs.slack_user_id;
  const v = Array.isArray(sid) ? sid[0] : sid;
  return Boolean(v != null && String(v).trim() !== "");
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

async function enrichListRow(u: Record<string, unknown>): Promise<AdminUsersListItem> {
  const id = String(u.id ?? "");
  const roleRows = await listRealmRoleMappingsForUser(id);
  return {
    id,
    username: String(u.username ?? ""),
    email: String(u.email ?? ""),
    firstName:
      u.firstName !== undefined && u.firstName !== null ? String(u.firstName) : "",
    lastName: u.lastName !== undefined && u.lastName !== null ? String(u.lastName) : "",
    enabled: u.enabled !== false,
    attributes: normalizeAttributes(u.attributes),
    roles: roleRows.map((r) => r.name),
  };
}

async function userMatchesFilters(
  u: Record<string, unknown>,
  opts: {
    roleIdSet: Set<string> | null;
    teamEmailSet: Set<string> | null;
    idp: string | null;
    slackStatus: "linked" | "unlinked" | null;
  }
): Promise<boolean> {
  const id = String(u.id ?? "");
  if (opts.roleIdSet && !opts.roleIdSet.has(id)) return false;

  const email = String(u.email ?? "").trim().toLowerCase();
  if (opts.teamEmailSet && !opts.teamEmailSet.has(email)) return false;

  if (opts.slackStatus === "linked" && !isSlackLinkedFromUser(u)) return false;
  if (opts.slackStatus === "unlinked" && isSlackLinkedFromUser(u)) return false;

  if (opts.idp) {
    const feds = await getUserFederatedIdentities(id);
    const ok = feds.some((f) => f.identityProvider === opts.idp);
    if (!ok) return false;
  }

  return true;
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  return withAuth(request, async (req, _user, session) => {
    requireAdminView(session);

    const url = new URL(req.url);
    const search = (url.searchParams.get("search") ?? "").trim() || undefined;
    const role = (url.searchParams.get("role") ?? "").trim() || undefined;
    const team = (url.searchParams.get("team") ?? "").trim() || undefined;
    const idp = (url.searchParams.get("idp") ?? "").trim() || undefined;
    const slackRaw = (url.searchParams.get("slackStatus") ?? "").trim().toLowerCase();
    const slackStatus =
      slackRaw === "linked" || slackRaw === "unlinked"
        ? (slackRaw as "linked" | "unlinked")
        : slackRaw === ""
          ? null
          : (() => {
              throw new ApiError('slackStatus must be "linked" or "unlinked"', 400);
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
      const users = await Promise.all(raw.map((row) => enrichListRow(row)));
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
          pageRows.push(await enrichListRow(row));
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
});
