import { NextRequest, NextResponse } from "next/server";

import { getTomeAuthFromBearerOrSession } from "@/lib/tome/auth";
import { TOME_MCP_OIDC_PROOF_HEADER } from "@/lib/tome/oidc-jwt";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import {
  createTomeMcpSseSession,
  createTomeMcpSseStream,
  mcpSseHeaders,
  publicOrigin,
} from "@/lib/tome/mcp-sse";

export const dynamic = "force-dynamic";

function optionsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: mcpSseHeaders("text/plain") });
}

export function OPTIONS(): NextResponse {
  return optionsResponse();
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isTomeServerEnabled()) return new NextResponse("Not found", { status: 404 });

  let ownerSub: string;
  try {
    const { session } = await getTomeAuthFromBearerOrSession(request);
    requireInteractiveTomePrincipal(session);
    if ("tomeOidcProof" in session && session.tomeOidcProof) {
      request.headers.set(TOME_MCP_OIDC_PROOF_HEADER, session.tomeOidcProof);
    }
    ownerSub = session.sub || "";
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ownerSub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = createTomeMcpSseSession(ownerSub);
  if (!session) {
    return NextResponse.json(
      { error: "Too many active MCP SSE sessions" },
      { status: 429, headers: { "Retry-After": "30" } },
    );
  }

  const endpoint = `${publicOrigin(request)}/api/tome/mcp/messages?sessionId=${encodeURIComponent(session.id)}`;
  return new Response(createTomeMcpSseStream(session, endpoint), {
    headers: mcpSseHeaders("text/event-stream"),
  });
}
