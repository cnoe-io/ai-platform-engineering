// GET /metrics — Prometheus scrape endpoint for caipe-ui.
//
// Deliberately at the bare root path (not /api/metrics) to match the
// Prometheus Operator ServiceMonitor default (`metrics.path: "/metrics"` in
// charts/ai-platform-engineering/values.yaml) and every other instrumented
// service in this repo (dynamic-agents, tome-agent).
//
// Unauthenticated by design, like dynamic-agents' and tome-agent's /metrics —
// scrapers don't carry user sessions. Only reachable on the internal docker
// network / cluster network in practice, never internet-exposed.
//
// Not wrapped in withErrorHandler (that wrapper itself records HTTP metrics
// against this same registry — recording /metrics scrapes as metrics would
// be circular and noisy).

import { NextResponse } from "next/server";

import { getMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const { registry } = getMetrics();
  const body = await registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": registry.contentType },
  });
}
