import { proxyHarnessEngine } from "@/lib/harness-engine-proxy";
import { NextRequest } from "next/server";
import { authorizeEngineRun } from "../_authorization";

export const runtime = "nodejs";
interface Context { params: Promise<{ runId: string }> }

async function proxy(request: NextRequest, context: Context, method: "GET" | "DELETE"): Promise<Response> {
  const { runId } = await context.params;
  const authorized = await authorizeEngineRun(request, runId, method === "DELETE");
  if (authorized instanceof Response) return authorized;
  return method === "GET" ? authorized.response : proxyHarnessEngine(
    authorized.config, authorized.auth, `/api/v1/runs/${encodeURIComponent(runId)}`, { method },
  );
}
export const GET = (request: NextRequest, context: Context) => proxy(request, context, "GET");
export const DELETE = (request: NextRequest, context: Context) => proxy(request, context, "DELETE");
