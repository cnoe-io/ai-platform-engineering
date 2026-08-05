/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) =>
    mockGetAuthFromBearerOrSession(...args),
}));

jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => true,
}));

import { POST } from "../route";

const originalTomePublicOrigin = process.env.TOME_PUBLIC_ORIGIN;

describe("Tome MCP authentication challenge", () => {
  beforeEach(() => {
    mockGetAuthFromBearerOrSession.mockRejectedValue(
      new Error("unauthenticated"),
    );
    process.env.TOME_PUBLIC_ORIGIN = "https://grid.example.test";
  });

  afterAll(() => {
    if (originalTomePublicOrigin === undefined)
      delete process.env.TOME_PUBLIC_ORIGIN;
    else process.env.TOME_PUBLIC_ORIGIN = originalTomePublicOrigin;
  });

  it("advertises the resource-specific RFC 9728 metadata URL", async () => {
    const response = await POST(
      new NextRequest("http://caipe-ui:3000/api/tome/mcp", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="tome-mcp", resource_metadata="https://grid.example.test/.well-known/oauth-protected-resource/api/tome/mcp"',
    );
  });
});
