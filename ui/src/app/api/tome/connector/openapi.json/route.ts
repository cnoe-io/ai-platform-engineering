import { NextRequest, NextResponse } from "next/server";

import { isTomeServerEnabled } from "@/lib/tome/guard";
import { publicOrigin } from "@/lib/tome/mcp-sse";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): NextResponse {
  if (!isTomeServerEnabled()) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json(
    {
      openapi: "3.0.3",
      info: {
        title: "TOME REST Connector API",
        version: "0.1.0",
        description:
          "Minimal authenticated TOME REST endpoint for connector connectivity checks.",
        license: {
          name: "Apache-2.0",
          url: "https://www.apache.org/licenses/LICENSE-2.0.html",
        },
      },
      servers: [{ url: `${publicOrigin(request)}/api/tome/connector` }],
      paths: {
        "/version": {
          get: {
            operationId: "getTomeVersion",
            summary: "Get the TOME connector version",
            description: "Returns a small non-sensitive response for connectivity checks.",
            security: [{ TomeApiKey: [] }],
            responses: {
              "200": {
                description: "TOME connector version",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["service", "version", "status"],
                      properties: {
                        service: { type: "string", example: "tome" },
                        version: { type: "string", example: "0.1.0" },
                        status: { type: "string", example: "ok" },
                      },
                      additionalProperties: false,
                    },
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
            description:
              "User-minted TOME-only API token. Clients may send the raw token or prefix it with Bearer.",
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
