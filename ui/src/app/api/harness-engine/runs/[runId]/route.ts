import { authenticateRequest } from "@/lib/da-proxy";
import { getHarnessEngineConfig, proxyHarnessEngine } from "@/lib/harness-engine-proxy";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface Context { params: Promise<{ runId: string }> }

async function proxy(request: NextRequest, context: Context, method: "GET" | "DELETE") {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  const config = getHarnessEngineConfig();
  if (config instanceof NextResponse) return config;
  const { runId } = await context.params;
  return proxyHarnessEngine(config, auth, `/api/v1/runs/${encodeURIComponent(runId)}`, { method });
}

export const GET = (request: NextRequest, context: Context) => proxy(request, context, "GET");
export const DELETE = (request: NextRequest, context: Context) => proxy(request, context, "DELETE");
