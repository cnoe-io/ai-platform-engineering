import { NextRequest, NextResponse } from "next/server";

import { isTomeServerEnabled } from "@/lib/tome/guard";
import { publicOrigin } from "@/lib/tome/mcp-sse";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Caipe-Token",
  "Access-Control-Allow-Methods": "GET, OPTIONS, POST",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Public discovery response for Connector Studio's REST connector flow. */
export function GET(request: NextRequest): NextResponse {
  if (!isTomeServerEnabled()) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json(
    {
      name: "tome",
      version: "0.1.0",
      description: "REST operations for TOME projects, wikis, feeds, ingests, and gists.",
      openapi_url: `${publicOrigin(request)}/api/tome/connector/openapi.json`,
    },
    { headers: CORS_HEADERS },
  );
}
