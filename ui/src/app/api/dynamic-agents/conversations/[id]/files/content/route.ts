/**
 * Conversation-scoped Dynamic Agents file content proxy.
 *
 * GET    /api/dynamic-agents/conversations/[id]/files/content?path=file.txt
 * DELETE /api/dynamic-agents/conversations/[id]/files/content?path=file.txt
 */

import { NextRequest, NextResponse } from "next/server";

import { withErrorHandler } from "@/lib/api-middleware";
import { authorizeConversationFileRequest } from "@/lib/conversation-file-authorization";
import { getDynamicAgentsConfig, proxyRequest } from "@/lib/da-proxy";

function buildFileNamespace(agentId: string, conversationId: string): string {
  return JSON.stringify([agentId, conversationId, "filesystem"]);
}

async function proxyFileContent(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  method: "GET" | "DELETE",
): Promise<Response> {
  const { id: conversationId } = await context.params;
  if (!conversationId) {
    return NextResponse.json(
      { success: false, error: "Conversation ID is required" },
      { status: 400 },
    );
  }

  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json(
      { success: false, error: "path query parameter is required" },
      { status: 400 },
    );
  }

  const authorization = await authorizeConversationFileRequest(
    request,
    conversationId,
    method === "GET" ? "read" : "write",
  );
  if (authorization instanceof NextResponse) return authorization;

  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  const backendUrl = new URL("/api/v1/files/content", daConfig.dynamicAgentsUrl);
  backendUrl.searchParams.set(
    "fs_namespace",
    buildFileNamespace(authorization.agentId, conversationId),
  );
  backendUrl.searchParams.set("path", filePath);

  return proxyRequest(
    backendUrl.toString(),
    method,
    authorization.authResult,
    `[conversation-files/content:${method}]`,
  );
}

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> => proxyFileContent(request, context, "GET"),
);

export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> => proxyFileContent(request, context, "DELETE"),
);
