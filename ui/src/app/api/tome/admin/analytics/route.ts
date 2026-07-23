// GET /api/tome/admin/analytics — org-wide TOME consumption: which projects
// are actively ingesting, wiki size, ingest cadence/token usage. Gated the
// same way as /api/tome/admin (can_manage on admin_surface:tome).
//
// Deliberately does NOT include chat engagement / per-user data — that stays
// scoped to each project's own /api/tome/projects/[slug]/engagement.

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import {
  getOrgTomeConsumption,
  getTomeAdoption,
  getTomeAdoptionTrend,
  getTomeFreshness,
  getTomeFreshnessTrend,
  getTomeIngestActivityTrend,
  getTomeQueryLatencyP95,
  getTomeQueryLatencyTrend,
  getTomeUptime,
  getTomeUptimeTrend,
} from "@/lib/tome/analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isTomeAdmin(session);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Each KPI/trend source is independent (Mongo vs. Prometheus) and
  // best-effort — one failing must not take down the others or the
  // consumption table. 30-day window for the daily trends mirrors the KPI
  // cards' default `windowDays`; the performance trend uses a shorter 7-day
  // window since Prometheus retention is typically much shorter than Mongo's.
  const [
    { rows, totals },
    adoption,
    freshness,
    performance,
    uptime,
    adoptionTrend,
    freshnessTrend,
    ingestActivityTrend,
    performanceTrend,
    uptimeTrend,
  ] = await Promise.all([
    getOrgTomeConsumption(),
    getTomeAdoption(),
    getTomeFreshness(),
    getTomeQueryLatencyP95(),
    getTomeUptime(),
    getTomeAdoptionTrend(),
    getTomeFreshnessTrend(),
    getTomeIngestActivityTrend(),
    getTomeQueryLatencyTrend(),
    getTomeUptimeTrend(),
  ]);
  return NextResponse.json({
    data: {
      projects: rows,
      totals,
      adoption,
      freshness,
      performance,
      uptime,
      trends: {
        adoption: adoptionTrend,
        freshness: freshnessTrend,
        ingestActivity: ingestActivityTrend,
        performance: performanceTrend,
        uptime: uptimeTrend,
      },
    },
  });
}
