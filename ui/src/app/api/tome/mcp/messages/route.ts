import { NextRequest, NextResponse } from "next/server";

import { getTomeAuthFromBearerOrSession } from "@/lib/tome/auth";
import { TOME_MCP_OIDC_PROOF_HEADER } from "@/lib/tome/oidc-jwt";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import {
  closeTomeMcpSseSession,
  forwardMcpHeaders,
  getTomeMcpSseSession,
  mcpInternalOrigin,
  mcpSseHeaders,
  writeTomeMcpSseEvent,
} from "@/lib/tome/mcp-sse";

export const dynamic = "force-dynamic";

function optionsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: mcpSseHeaders("text/plain") });
}

export function OPTIONS(): NextResponse {
  return optionsResponse();
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isTomeServerEnabled()) return new NextResponse("Not found", { status: 404 });

  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  const sseSession = getTomeMcpSseSession(sessionId);
  if (!sseSession) return NextResponse.json({ error: "Unknown or expired SSE session" }, { status: 404 });

  try {
    const { session } = await getTomeAuthFromBearerOrSession(request);
    requireInteractiveTomePrincipal(session);
    if ("tomeOidcProof" in session && session.tomeOidcProof) {
      request.headers.set(TOME_MCP_OIDC_PROOF_HEADER, session.tomeOidcProof);
    }
    if (session.sub !== sseSession.ownerSub) {
      return NextResponse.json({ error: "SSE session owner mismatch" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${mcpInternalOrigin(request)}/api/tome/mcp`, {
      method: "POST",
      headers: forwardMcpHeaders(request),
      body: JSON.stringify(payload),
    });
  } catch {
    closeTomeMcpSseSession(sseSession);
    return NextResponse.json({ error: "MCP transport unavailable" }, { status: 502 });
  }

  const text = await response.text();
  if (!response.ok) {
    return new NextResponse(text || "MCP request failed", {
      status: response.status,
      headers: mcpSseHeaders("application/json"),
    });
  }

  if (text) {
    let message: unknown = text;
    try {
      message = JSON.parse(text);
    } catch {
      // Preserve a non-JSON response as an SSE string for diagnostics.
    }
    writeTomeMcpSseEvent(sseSession, "message", message);
  }

  return new NextResponse(null, { status: 202, headers: mcpSseHeaders("text/plain") });
}
