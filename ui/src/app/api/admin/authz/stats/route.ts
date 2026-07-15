// assisted-by Codex Codex-sonnet-4-6
//
// GET /api/admin/authz/stats — CAS health + decision statistics.
//
//   engine    — live, per-replica adapter snapshot (circuit state, cache).
//   decisions — durable aggregation over audit-service cas_decision events in
//               a time window: totals, deny rate, by-reason, top-denied.
//
// Gated by the same baseline "metrics" admin surface as /api/admin/metrics.

import { NextRequest, NextResponse } from "next/server";

import { ApiError, getAuthFromBearerOrSession, withErrorHandler } from "@/lib/api-middleware";
import { getAuditReader } from "@/lib/audit/reader";
import { getEngineStats } from "@/lib/authz";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";

const WINDOWS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function increment(map: Map<string, number>, key: string | undefined): void {
  map.set(key ?? "UNKNOWN", (map.get(key ?? "UNKNOWN") ?? 0) + 1);
}

function topCounts(map: Map<string, number>, label: "reason" | "resource"): Record<string, string | number>[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, label === "resource" ? 10 : undefined)
    .map(([key, count]) => ({ [label]: key || "unknown", count }));
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "metrics");

  const url = new URL(request.url);
  const windowKey = url.searchParams.get("window") ?? "24h";
  const windowMs = WINDOWS[windowKey];
  if (!windowMs) {
    throw new ApiError(`\`window\` must be one of: ${Object.keys(WINDOWS).join(", ")}`, 400, "VALIDATION_ERROR");
  }

  const engine = getEngineStats();
  const until = new Date();
  const since = new Date(until.getTime() - windowMs);
  const org = (session as { org?: string } | null)?.org;
  const rows = await getAuditReader().query({
    since,
    until,
    type: "cas_decision",
    tenantId: org,
    limit: 10_000,
  });

  let allow = 0;
  let deny = 0;
  const byReason = new Map<string, number>();
  const topDenied = new Map<string, number>();

  for (const row of rows) {
    const outcome = row.outcome;
    if (outcome === "allow") allow += 1;
    if (outcome === "deny") {
      deny += 1;
      increment(topDenied, typeof row.resource_ref === "string" ? row.resource_ref : undefined);
    }
    increment(byReason, typeof row.reason_code === "string" ? row.reason_code : undefined);
  }

  const total = rows.length;

  return NextResponse.json(
    {
      engine,
      window: windowKey,
      persistence: true,
      decisions: {
        total,
        allow,
        deny,
        denyRate: total > 0 ? deny / total : 0,
        byReason: topCounts(byReason, "reason"),
        topDenied: topCounts(topDenied, "resource"),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
