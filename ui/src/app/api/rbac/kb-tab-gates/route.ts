import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isBootstrapAdmin } from "@/lib/auth-config";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";
import { filterResourcesByPermission } from "@/lib/rbac/resource-authz";
import type { KbTabGatesMap } from "@/lib/rbac/types";

/**
 * GET /api/rbac/kb-tab-gates
 *
 * Returns visibility for the four tabs in the Knowledge sidebar
 * (`search`, `data_sources`, `graph`, `mcp_tools`) plus the convenience
 * `has_any_kb` flag the sidebar uses to render an empty-state banner.
 *
 * Decision order (mirrors `/api/rbac/admin-tab-gates`):
 *   1. Org admin (`organization#admin` via `can_manage organization:<key>`)
 *      or `BOOTSTRAP_ADMIN_EMAILS` → all tabs visible, `kb_count: -1` ("admin
 *      bypass, unknown count"), `has_any_kb: true`. This is the documented
 *      super-grant established by PR 1 of the 2026-05-27 fine-grained KB
 *      ReBAC plan.
 *   2. Non-admin → count the readable knowledge bases by listing
 *      `/v1/datasources` from the RAG server (proxied with the session's
 *      bearer token) and filtering via `filterResourcesByPermission` on
 *      `knowledge_base:<id>#can_read`. The same count drives `search`,
 *      `data_sources`, and `graph` visibility.
 *
 * Kill switch: `RAG_ADMIN_BYPASS_DISABLED=true` disables the org-admin
 * super-grant and forces a per-resource path even for admins, matching the
 * behaviour of `filterResourcesByPermission({ bypassForOrgAdmin: true })`.
 *
 * Failure mode: fails closed (all tabs hidden) on any backend error so the
 * sidebar never silently exposes a tab that the API would 403.
 */
const EMPTY_GATES: KbTabGatesMap = {
  search: false,
  data_sources: false,
  graph: false,
  mcp_tools: false,
  has_any_kb: false,
  kb_count: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSessionSubject(session: {
  accessToken?: string;
  sub?: string;
}): string | undefined {
  if (session.sub) return session.sub;
  if (!session.accessToken) return undefined;
  try {
    const parts = session.accessToken.split(".");
    if (parts.length < 2) return undefined;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as
      | { sub?: unknown }
      | undefined;
    return typeof payload?.sub === "string" ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

function isOrgAdminBypassKillSwitchEnabled(): boolean {
  const raw = process.env.RAG_ADMIN_BYPASS_DISABLED;
  if (!raw) return false;
  return raw === "1" || raw.trim().toLowerCase() === "true";
}

async function isOrgAdmin(session: {
  accessToken?: string;
  sub?: string;
  user?: { email?: string | null };
}): Promise<boolean> {
  if (isOrgAdminBypassKillSwitchEnabled()) return false;
  if (isBootstrapAdmin(session.user?.email ?? "")) return true;
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

function getRagServerUrl(): string {
  return (
    process.env.RAG_SERVER_URL ||
    process.env.NEXT_PUBLIC_RAG_URL ||
    "http://localhost:9446"
  );
}

function datasourceIdOf(resource: Record<string, unknown>): string {
  const value = resource.datasource_id ?? resource.id;
  return typeof value === "string" ? value : "";
}

async function loadReadableKbCount(session: {
  sub?: string;
  role?: string;
  user?: { email?: string | null };
  accessToken: string;
  org?: string;
}): Promise<number> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
  if (session.org) headers["X-Tenant-Id"] = session.org;

  let response: Response;
  try {
    response = await fetch(`${getRagServerUrl()}/v1/datasources`, {
      method: "GET",
      headers,
    });
  } catch {
    return 0;
  }
  if (!response.ok) return 0;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return 0;
  }
  if (!isRecord(data) || !Array.isArray((data as { datasources?: unknown }).datasources)) {
    return 0;
  }

  const candidates = (data as { datasources: unknown[] }).datasources
    .filter(isRecord)
    .filter((resource) => datasourceIdOf(resource));
  if (candidates.length === 0) return 0;

  try {
    const allowed = await filterResourcesByPermission(
      { sub: session.sub, role: session.role, user: session.user },
      candidates,
      { type: "knowledge_base", action: "read", id: datasourceIdOf },
      { bypassForOrgAdmin: false },
    );
    return allowed.length;
  } catch {
    return 0;
  }
}

export async function GET() {
  const session = (await getServerSession(authOptions)) as
    | {
        accessToken?: string;
        sub?: string;
        role?: string;
        org?: string;
        user?: { email?: string | null };
      }
    | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (await isOrgAdmin(session)) {
    const gates: KbTabGatesMap = {
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: -1,
    };
    return NextResponse.json({ gates, org_admin_bypass: true });
  }

  if (!session.accessToken) {
    return NextResponse.json({ gates: EMPTY_GATES, org_admin_bypass: false });
  }

  const kbCount = await loadReadableKbCount({
    sub: session.sub,
    role: session.role,
    user: session.user,
    accessToken: session.accessToken,
    org: session.org,
  });

  const hasAnyKb = kbCount > 0;
  const gates: KbTabGatesMap = {
    search: hasAnyKb,
    data_sources: hasAnyKb,
    graph: hasAnyKb,
    // PR 2 keeps `mcp_tools` true when the user has any readable KB. PR 4
    // will replace this with a per-`mcp_tool` check once the model type
    // exists; the existing baseline reader on the RAG server still returns
    // an empty list if nothing matches, so this is no worse than today.
    mcp_tools: hasAnyKb,
    has_any_kb: hasAnyKb,
    kb_count: kbCount,
  };

  return NextResponse.json({ gates, org_admin_bypass: false });
}
