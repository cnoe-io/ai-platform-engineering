import { NextRequest, NextResponse } from "next/server";

import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

function publicOrigin(request: NextRequest): string {
  const configured = process.env.TOME_PUBLIC_ORIGIN || process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to proxy/request-derived origin.
    }
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    return `${request.headers.get("x-forwarded-proto") || "https"}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}
/**
 * Connector Studio requires an OpenAPI document before it can register a
 * remote connector. TOME's native protocol is JSON-RPC over Streamable HTTP,
 * so this document describes the single RPC transport operation rather than
 * pretending that each MCP tool is a REST endpoint.
 */
export function GET(request: NextRequest) {
  if (!isTomeServerEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const endpoint = `${publicOrigin(request)}/api/tome/mcp`;
  return NextResponse.json(
    {
      openapi: "3.0.3",
      info: {
        title: "TOME MCP",
        version: "0.1.0",
        description: "TOME project, wiki, feed, ingest, and gist tools over MCP JSON-RPC.",
      },
      servers: [{ url: endpoint }],
      paths: {
        "/": {
          post: {
            operationId: "tomeMcp",
            summary: "Invoke a TOME MCP JSON-RPC operation",
            description:
              "Streamable HTTP MCP transport. Use tools/list to discover tools and tools/call to invoke one.",
            security: [{ TomeApiKey: [] }, { BearerAuth: [] }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/JsonRpcRequest" },
                  examples: {
                    listTools: {
                      summary: "List available TOME tools",
                      value: { jsonrpc: "2.0", id: 1, method: "tools/list" },
                    },
                    listProjects: {
                      summary: "List accessible TOME projects",
                      value: {
                        jsonrpc: "2.0",
                        id: 2,
                        method: "tools/call",
                        params: { name: "tome_list_projects", arguments: {} },
                      },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "JSON-RPC response",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/JsonRpcResponse" },
                  },
                },
              },
              "401": { description: "Authentication required or invalid" },
              "403": { description: "The authenticated user lacks TOME access" },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          TomeApiKey: {
            type: "apiKey",
            in: "header",
            name: "x-caipe-token",
            description: "User-minted TOME-only API token.",
          },
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Keycloak/OIDC access token.",
          },
        },
        schemas: {
          JsonRpcRequest: {
            type: "object",
            required: ["jsonrpc", "method"],
            properties: {
              jsonrpc: { type: "string", enum: ["2.0"] },
              id: { oneOf: [{ type: "string" }, { type: "integer" }, { type: "null" }] },
              method: { type: "string", enum: ["initialize", "ping", "tools/list", "tools/call"] },
              params: { type: "object", additionalProperties: true },
            },
          },
          JsonRpcResponse: {
            type: "object",
            required: ["jsonrpc"],
            properties: {
              jsonrpc: { type: "string", enum: ["2.0"] },
              id: { oneOf: [{ type: "string" }, { type: "integer" }, { type: "null" }] },
              result: { type: "object", additionalProperties: true },
              error: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
