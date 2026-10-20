import { authorizeEngineRun } from "../../_authorization";
import { proxyHarnessEngine } from "@/lib/harness-engine-proxy";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  const authorized = await authorizeEngineRun(request, runId);
  if (authorized instanceof Response) return authorized;
  const { auth, config } = authorized;
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
