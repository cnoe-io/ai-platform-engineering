import { withHarnessGatewayTarget, getHarnessGatewayRun, publicHarnessGatewayRun } from "@/lib/harness-gateway";
import { NextRequest, NextResponse } from "next/server";

import { proxyRequest } from "@/lib/da-proxy";

import { authorizeRunReadRequest } from "../_authorization";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  const authorized = await authorizeRunReadRequest(request);
  if (authorized instanceof NextResponse) return authorized;
  const { runId } = await context.params;
  if (authorized.target.kind === "harness_engine") {
    const run = await getHarnessGatewayRun(authorized.authResult,
      { agentId: authorized.agentId, conversationId: authorized.runtimeId }, runId);
    if (run instanceof NextResponse) return run;
    return NextResponse.json({ run: publicHarnessGatewayRun(run) }, { headers: { "Cache-Control": "private, no-store", "X-Harness-ID": authorized.target.harnessId } });
  }
  authorized.backendUrl!.pathname += `/${encodeURIComponent(runId)}`;
  return withHarnessGatewayTarget(await proxyRequest(authorized.backendUrl!.toString(), "GET", authorized.authResult, "[runs/status]"), authorized.target);
}
