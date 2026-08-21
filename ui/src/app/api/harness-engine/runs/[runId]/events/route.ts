import { authenticateRequest } from "@/lib/da-proxy";
import { getHarnessEngineConfig, proxyHarnessEngine } from "@/lib/harness-engine-proxy";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  const config = getHarnessEngineConfig();
  if (config instanceof NextResponse) return config;
  const { runId } = await context.params;
  const query = new URLSearchParams();
  for (const key of ["after", "wait"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }
  const suffix = query.size ? `?${query}` : "";
  return proxyHarnessEngine(
    config,
    auth,
    `/api/v1/runs/${encodeURIComponent(runId)}/events${suffix}`,
  );
}
