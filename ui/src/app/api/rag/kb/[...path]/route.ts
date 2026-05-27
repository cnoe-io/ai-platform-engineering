import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { requireRbacPermission, handleApiError } from "@/lib/api-middleware";
import type { RbacScope } from "@/lib/rbac/types";
import { requireResourcePermission, type ResourcePermissionAction } from "@/lib/rbac/resource-authz";

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

function scopeForMethod(method: string): RbacScope {
  switch (method) {
    case "GET":
      return "kb.query";
    case "POST":
      return "kb.ingest";
    case "PATCH":
      return "kb.admin";
    default:
      return "kb.admin";
  }
}

function actionForKbRequest(method: string, pathSegments: string[]): ResourcePermissionAction {
  const path = pathSegments.join("/").toLowerCase();
  if (method === "GET") return path.includes("query") || path.includes("search") ? "read" : "discover";
  if (method === "POST") return path.includes("query") || path.includes("search") ? "read" : "ingest";
  return "admin";
}

function extractKnowledgeBaseId(
  request: NextRequest,
  pathSegments: string[],
  body?: unknown,
): string | null {
  for (const key of ["kb_id", "knowledge_base_id", "knowledgeBaseId", "datasource_id", "datasourceId"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) return value;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const bodyValue = (body as Record<string, unknown>)[key];
      if (typeof bodyValue === "string" && bodyValue.trim()) return bodyValue.trim();
    }
  }
  return pathSegments[0] && !["query", "search", "ingest", "upload", "datasources"].includes(pathSegments[0])
    ? pathSegments[0]
    : null;
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

  let body: unknown = undefined;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        body = await request.json();
      } catch {
        /* empty body is ok for some endpoints */
      }
    }
  }

  const scope = scopeForMethod(method);
  await requireRbacPermission(
    { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
    "rag",
    scope,
  );
  const kbId = extractKnowledgeBaseId(request, pathSegments, body);
  if (kbId) {
    await requireResourcePermission(
      { sub: session.sub, role: session.role, user: session.user },
      { type: "knowledge_base", id: kbId, action: actionForKbRequest(method, pathSegments) },
      { bypassForOrgAdmin: true },
    );
  }

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
  // Phase 3 of spec 2026-05-24-derive-team-from-channel removed both
  // the X-Team-Id header AND the `active_team` JWT claim. RAG derives
  // the user's team list from OpenFGA at request time using the
  // bearer-token subject.

  const fetchOptions: RequestInit = { method, headers };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    return await proxyToRag(request, path, "PATCH");
  } catch (error) {
    return handleApiError(error);
  }
}
