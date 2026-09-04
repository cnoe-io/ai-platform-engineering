import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { getTomeMcpTool } from "@/app/api/tome/mcp/route";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import { mcpSseHeaders } from "@/lib/tome/mcp-sse";

export const dynamic = "force-dynamic";

function jsonHeaders(): HeadersInit {
  return mcpSseHeaders("application/json");
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: jsonHeaders() });
}

function responseData(result: { content?: Array<{ type?: string; text?: string }> }): unknown {
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function missingRequiredArguments(
  args: Record<string, unknown>,
  required: unknown,
): string[] {
  if (!Array.isArray(required)) return [];
  return required.filter(
    (name): name is string =>
      typeof name === "string" &&
      (args[name] === undefined || args[name] === null || args[name] === ""),
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ toolName: string }> },
): Promise<NextResponse> {
  if (!isTomeServerEnabled()) return new NextResponse("Not found", { status: 404 });

  const { toolName } = await context.params;
  const tool = getTomeMcpTool(toolName);
  if (!tool) return errorResponse(`Unknown TOME operation: ${toolName}`, 404);

  try {
    const { session } = await getAuthFromBearerOrSession(request);
    requireInteractiveTomePrincipal(session);
  } catch {
    return errorResponse("Unauthorized", 401);
  }

  let args: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object", 400);
    }
    args = body as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON", 400);
  }

  const missing = missingRequiredArguments(args, tool.inputSchema.required);
  if (missing.length) {
    return errorResponse(`Missing required argument(s): ${missing.join(", ")}`, 400);
  }

  try {
    const result = await tool.handler(request, async (method, path, body) => {
      const origin = process.env.TOME_INTERNAL_ORIGIN || new URL(request.url).origin;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      for (const name of ["authorization", "cookie", "x-caipe-token"]) {
        const value = request.headers.get(name);
        if (value) headers[name] = value;
      }
      const response = await fetch(`${origin.replace(/\/$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Preserve non-JSON upstream errors for the shared handler.
      }
      return { status: response.status, json, text };
    }, args);

    const data = responseData(result);
    if (result.isError) return errorResponse(typeof data === "string" ? data : "Operation failed", 422);
    return NextResponse.json({ data }, { headers: jsonHeaders() });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Operation failed", 502);
  }
}
