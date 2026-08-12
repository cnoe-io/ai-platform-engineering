import { NextRequest, NextResponse } from "next/server";

import {
  authenticateRequest,
  buildBackendHeaders,
  getDynamicAgentsConfig,
} from "@/lib/da-proxy";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  const config = getDynamicAgentsConfig();
  if (config instanceof NextResponse) return config;
  const { id } = await context.params;
  let response: Response;
  try {
    response = await fetch(
      `${config.dynamicAgentsUrl}/api/v1/agents/${encodeURIComponent(id)}/memory-namespaces`,
      { headers: buildBackendHeaders("application/json", auth), cache: "no-store" },
    );
  } catch {
    return NextResponse.json(
      { success: false, error: "Memory namespaces are temporarily unavailable" },
      { status: 503 },
    );
  }
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
}
