import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { requireRbacPermission, handleApiError } from "@/lib/api-middleware";
import type { RbacScope } from "@/lib/rbac/types";

/**
 * KB admin/ingest/query proxy with 098 RBAC enforcement (FR-015).
 *
 * Routes under /api/rag/kb/* are proxied to the RAG server after verifying
 * the caller has the appropriate Keycloak AuthZ permission:
 *
 *   GET  /api/rag/kb/*   → rag#kb.query   (chat_user+)
 *   POST /api/rag/kb/*   → rag#kb.ingest  (kb_admin+)  — ingest operations
 *   PUT  /api/rag/kb/*   → rag#kb.admin   (kb_admin+)  — KB configuration
 *   DELETE /api/rag/kb/* → rag#kb.admin   (kb_admin+)  — KB deletion
 *
 * After RBAC check passes, the request is forwarded to the RAG server with
 * the caller's access token.
 */

function getRagServerUrl(): string {
  return (
    process.env.RAG_SERVER_URL ||
    process.env.NEXT_PUBLIC_RAG_URL ||
    "http://localhost:9446"
  );
}

function decodeJwtPayload(accessToken: string | undefined): Record<string, unknown> {
  if (!accessToken) return {};
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return {};
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** First `team_member(<id>)` from realm_access.roles, for X-Team-Id upstream. */
function extractTeamIdFromAccessToken(accessToken: string | undefined): string | undefined {
  const roles = (decodeJwtPayload(accessToken).realm_access as { roles?: string[] } | undefined)
    ?.roles;
  if (!Array.isArray(roles)) return undefined;
  for (const role of roles) {
    const match = String(role).match(/^team_member\((.+)\)$/);
    if (match) return match[1];
  }
  return undefined;
}

function scopeForMethod(method: string): RbacScope {
  switch (method) {
    case "GET":
      return "kb.query";
    case "POST":
      return "kb.ingest";
    default:
      return "kb.admin";
  }
}

async function proxyToRag(
  request: NextRequest,
  pathSegments: string[],
  method: string,
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = scopeForMethod(method);
  await requireRbacPermission(
    { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
    "rag",
    scope,
  );

  const ragServerUrl = getRagServerUrl();
  const targetPath = pathSegments.join("/");
  const targetUrl = new URL(`${ragServerUrl}/${targetPath}`);

  if (method === "GET" || method === "DELETE") {
    request.nextUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session.accessToken) {
    headers["Authorization"] = `Bearer ${session.accessToken}`;
  }
  if (session.org) {
    headers["X-Tenant-Id"] = session.org;
  }
  const teamId = extractTeamIdFromAccessToken(session.accessToken);
  if (teamId) {
    headers["X-Team-Id"] = teamId;
  }

  const fetchOptions: RequestInit = { method, headers };

  if (method === "POST" || method === "PUT") {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        const body = await request.json();
        fetchOptions.body = JSON.stringify(body);
      } catch {
        /* empty body is ok for some endpoints */
      }
    }
  }

  const response = await fetch(targetUrl.toString(), fetchOptions);

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    return await proxyToRag(request, path, "GET");
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    return await proxyToRag(request, path, "POST");
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    return await proxyToRag(request, path, "PUT");
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    return await proxyToRag(request, path, "DELETE");
  } catch (error) {
    return handleApiError(error);
  }
}
