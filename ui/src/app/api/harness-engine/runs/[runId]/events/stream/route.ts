import { authenticateRequest } from "@/lib/da-proxy";
import { getHarnessEngineConfig, proxyHarnessEngineStream } from "@/lib/harness-engine-proxy";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  const config = getHarnessEngineConfig();
  if (config instanceof NextResponse) return config;
  const { runId } = await context.params;
  const after = request.nextUrl.searchParams.get("after") ?? request.headers.get("last-event-id");
  const suffix = after === null ? "" : `?after=${encodeURIComponent(after)}`;

  // Aborting this fetch only drops this subscriber. The run was started by a
  // separate POST and is owned by Harness Engine, so provider execution and
  // event persistence continue after the browser/BFF connection disappears.
  return proxyHarnessEngineStream(
    config,
    auth,
    `/api/v1/runs/${encodeURIComponent(runId)}/events/stream${suffix}`,
    request.signal,
  );
}
