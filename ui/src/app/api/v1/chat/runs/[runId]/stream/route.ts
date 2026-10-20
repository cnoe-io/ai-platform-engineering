import { withHarnessGatewayTarget, getHarnessGatewayRun, replayHarnessGatewayRun } from "@/lib/harness-gateway";
import { NextRequest, NextResponse } from "next/server";

import { proxySSEStream } from "@/lib/da-proxy";

import { authorizeRunReadRequest } from "../../_authorization";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  const authorized = await authorizeRunReadRequest(request);
  if (authorized instanceof NextResponse) return authorized;
  const after = new URL(request.url).searchParams.get("after") ?? "0";
  const { runId } = await context.params;
  if (authorized.target.kind === "harness_engine") {
    const run = await getHarnessGatewayRun(authorized.authResult,
      { agentId: authorized.agentId, conversationId: authorized.runtimeId }, runId);
    if (run instanceof NextResponse) return run;
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return replayHarnessGatewayRun(run, authorized.authResult, after, request.signal);
  }
  if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after))) {
    return NextResponse.json({ success: false, error: "after must be a non-negative integer" }, { status: 400 });
  }
  authorized.backendUrl!.pathname += `/${encodeURIComponent(runId)}/stream`;
  authorized.backendUrl!.searchParams.set("after", after);
  return withHarnessGatewayTarget(await proxySSEStream(authorized.backendUrl!.toString(), undefined, authorized.authResult, "[runs/stream]", "GET"), authorized.target);
}
