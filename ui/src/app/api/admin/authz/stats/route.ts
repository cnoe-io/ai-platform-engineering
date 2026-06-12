// assisted-by Codex Codex-sonnet-4-6
//
// GET /api/admin/authz/stats — CAS health + decision statistics.
//
//   engine    — live, per-replica adapter snapshot (circuit state, cache).
//   decisions — durable aggregation over `audit_events` (cas_decision) in a
//               time window: totals, deny rate, by-reason, top-denied.
//
// Gated by the same baseline "metrics" admin surface as /api/admin/metrics.

import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession, withErrorHandler, ApiError } from "@/lib/api-middleware";
import { requireBaselineAdminSurfaceRead } from "@/lib/rbac/require-openfga";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getEngineStats } from "@/lib/authz";

const WINDOWS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

interface CountRow {
  _id: string;
  count: number;
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireBaselineAdminSurfaceRead(session, "metrics");

  const url = new URL(request.url);
  const windowKey = url.searchParams.get("window") ?? "24h";
  const windowMs = WINDOWS[windowKey];
  if (!windowMs) {
    throw new ApiError(`\`window\` must be one of: ${Object.keys(WINDOWS).join(", ")}`, 400, "VALIDATION_ERROR");
  }

  const engine = getEngineStats();

  if (!isMongoDBConfigured) {
    // Live engine stats still work without Mongo; decision history does not.
    return NextResponse.json(
      { engine, decisions: null, window: windowKey, persistence: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const from = new Date(Date.now() - windowMs);
  const baseFilter: Record<string, unknown> = { type: "cas_decision", ts: { $gte: from } };
  const org = (session as { org?: string } | null)?.org;
  if (org) baseFilter.tenant_id = org;

  const coll = await getCollection<Record<string, unknown>>("audit_events");

  const [total, allow, deny, byReasonRaw, topDeniedRaw] = await Promise.all([
    coll.countDocuments(baseFilter),
    coll.countDocuments({ ...baseFilter, outcome: "allow" }),
    coll.countDocuments({ ...baseFilter, outcome: "deny" }),
    coll
      .aggregate<CountRow>([
        { $match: baseFilter },
        { $group: { _id: "$reason_code", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    coll
      .aggregate<CountRow>([
        { $match: { ...baseFilter, outcome: "deny" } },
        { $group: { _id: "$resource_ref", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
  ]);

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
        byReason: byReasonRaw.map((r) => ({ reason: r._id ?? "UNKNOWN", count: r.count })),
        topDenied: topDeniedRaw.map((r) => ({ resource: r._id ?? "unknown", count: r.count })),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
