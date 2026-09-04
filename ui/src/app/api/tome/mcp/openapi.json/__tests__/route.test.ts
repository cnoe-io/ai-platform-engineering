/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

jest.mock("@/lib/tome/guard", () => ({ isTomeServerEnabled: () => true }));

import { GET } from "../route";

describe("TOME MCP OpenAPI document", () => {
  it("describes the MCP endpoint and x-caipe-token security scheme", async () => {
    const response = GET(
      new NextRequest("https://example.test/api/tome/mcp/openapi.json"),
    );
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.servers).toEqual([
      { url: "https://example.test/api/tome/mcp" },
    ]);
    expect(document.components.securitySchemes.TomeApiKey).toEqual({
      type: "apiKey",
      in: "header",
      name: "x-caipe-token",
      description: "User-minted TOME-only API token.",
    });
    expect(document.paths["/"].post.operationId).toBe("tomeMcp");
  });
});
