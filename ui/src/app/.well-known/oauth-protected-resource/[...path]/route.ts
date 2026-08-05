import { type NextRequest, NextResponse } from "next/server";

import { GET as getProtectedResourceMetadata } from "../route";

export const dynamic = "force-dynamic";

/**
 * RFC 9728 path-derived alias for the Tome MCP protected resource.
 *
 * Clients that have not yet received a WWW-Authenticate challenge derive
 * this URL from /api/tome/mcp as:
 * /.well-known/oauth-protected-resource/api/tome/mcp.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (path.join("/") !== "api/tome/mcp") {
    return new NextResponse("Not found", { status: 404 });
  }
  return getProtectedResourceMetadata(request);
}
