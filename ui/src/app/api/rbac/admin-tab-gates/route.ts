import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isBootstrapAdmin } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { evaluate as evalCel } from "@/lib/rbac/cel-evaluator";
import { getConfig } from "@/lib/config";
import type { AdminTabKey, AdminTabGatesMap, AdminTabPolicy } from "@/lib/rbac/types";

const ALL_TABS: AdminTabKey[] = [
  "users",
  "teams",
  "roles",
  "slack",
  "skills",
  "feedback",
  "nps",
  "stats",
  "metrics",
  "health",
  "audit_logs",
  "action_audit",
  "policy",
  "ag_policies",
];

const DEFAULT_POLICIES: AdminTabPolicy[] = [
  { tab_key: "users", expression: "true" },
  { tab_key: "teams", expression: "true" },
  { tab_key: "skills", expression: "true" },
  { tab_key: "metrics", expression: "true" },
  { tab_key: "health", expression: "true" },
  { tab_key: "roles", expression: "'admin' in user.roles" },
  { tab_key: "slack", expression: "'admin' in user.roles" },
  { tab_key: "feedback", expression: "'admin' in user.roles" },
  { tab_key: "nps", expression: "'admin' in user.roles" },
  { tab_key: "stats", expression: "'admin' in user.roles" },
  { tab_key: "audit_logs", expression: "'admin' in user.roles" },
  { tab_key: "action_audit", expression: "'admin' in user.roles" },
  { tab_key: "policy", expression: "'admin' in user.roles" },
  { tab_key: "ag_policies", expression: "'admin' in user.roles" },
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

function buildCelContext(session: {
  accessToken?: string;
  realmRoles?: string[];
  role?: string;
  user?: { email?: string | null };
}): Record<string, unknown> {
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

  // Bootstrap admins and users with session.role === 'admin' must have the
  // 'admin' role in the CEL context so admin-gated tabs are visible.
  if (!roles.includes("admin")) {
    if (session.role === "admin" || isBootstrapAdmin(email)) {
      roles.push("admin");
    }
  }

  return {
    user: {
      email,
      roles,
      teams: [] as string[],
    },
  };
}

/**
 * Feature-flag conjunctions: even if CEL allows a tab, the corresponding
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
 * Returns a map of { tab_key: boolean } indicating which admin tabs
 * the current user may see. Loads CEL policies from MongoDB, seeds
 * defaults when the collection is empty, evaluates each expression
 * against the user's JWT context, and applies feature-flag conjunctions.
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

  let policies: AdminTabPolicy[];
  try {
    const col = await getCollection<AdminTabPolicy>("admin_tab_policies");
    const docs = await col.find({}).toArray();

    if (docs.length === 0) {
      await col.insertMany(
        DEFAULT_POLICIES.map((p) => ({
          ...p,
          updated_at: new Date().toISOString(),
        }))
      );
      policies = DEFAULT_POLICIES;
    } else {
      policies = docs.map((d) => ({
        tab_key: d.tab_key,
        expression: d.expression,
      }));

      // Back-fill any tabs added after initial seed (e.g. action_audit)
      const existingKeys = new Set(policies.map((p) => p.tab_key));
      const missing = DEFAULT_POLICIES.filter((p) => !existingKeys.has(p.tab_key));
      if (missing.length > 0) {
        await col.insertMany(
          missing.map((p) => ({ ...p, updated_at: new Date().toISOString() }))
        );
        policies.push(...missing);
      }
    }
  } catch {
    policies = DEFAULT_POLICIES;
  }

  const policyMap = new Map(policies.map((p) => [p.tab_key, p.expression]));
  const ctx = buildCelContext(session);

  const gates: AdminTabGatesMap = {} as AdminTabGatesMap;
  for (const tab of ALL_TABS) {
    const expr = policyMap.get(tab) ?? "false";
    let allowed = evalCel(expr, ctx);

    const flagKey = TAB_FEATURE_FLAGS[tab];
    if (flagKey && allowed) {
      allowed = !!getConfig(flagKey as Parameters<typeof getConfig>[0]);
    }

    gates[tab] = allowed;
  }

  return NextResponse.json({ gates });
}

/**
 * PUT /api/rbac/admin-tab-gates
 *
 * Admin-only. Accepts { tab_key, expression } and upserts the CEL
 * expression for the given tab in admin_tab_policies. Validates the
 * expression by attempting a dry-run evaluation before persisting.
 */
export async function PUT(request: NextRequest) {
  const session = (await getServerSession(authOptions)) as {
    role?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { tab_key?: string; expression?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tab_key, expression } = body;
  if (
    !tab_key ||
    !expression ||
    typeof tab_key !== "string" ||
    typeof expression !== "string"
  ) {
    return NextResponse.json(
      { error: "tab_key and expression are required strings" },
      { status: 400 }
    );
  }

  if (!ALL_TABS.includes(tab_key as AdminTabKey)) {
    return NextResponse.json(
      { error: `Invalid tab_key. Must be one of: ${ALL_TABS.join(", ")}` },
      { status: 400 }
    );
  }

  const dryCtx = { user: { email: "test@test.com", roles: ["admin"], teams: [] } };
  try {
    evalCel(expression.trim(), dryCtx);
  } catch (e) {
    return NextResponse.json(
      { error: `Invalid CEL expression: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  try {
    const col = await getCollection<AdminTabPolicy>("admin_tab_policies");
    await col.updateOne(
      { tab_key } as Record<string, unknown>,
      {
        $set: {
          expression: expression.trim(),
          updated_by: session.user.email,
          updated_at: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Database error: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, tab_key, expression: expression.trim() });
}
