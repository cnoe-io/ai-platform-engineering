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

  it.each(["catalog_api_key", "skills_api_key"])(
    "rejects scoped %s credentials at the MCP transport",
    async (principalType) => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "catalog-user@example.test" },
      session: { principalType, sub: "catalog-user" },
    });
    const response = await POST(
      new NextRequest("http://caipe-ui:3000/api/tome/mcp", {
        method: "POST",
        headers: { authorization: "Bearer redacted" },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource/api/tome/mcp",
    );
    },
  );

  it("rejects legacy catalog-key sessions at the MCP transport", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "catalog-user@example.test" },
      session: { catalogKey: "redacted", sub: "catalog-user" },
    });

    const response = await POST(
      new NextRequest("http://caipe-ui:3000/api/tome/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("allows an interactive OIDC principal to list tools", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "viewer@example.test" },
      session: { principalType: "oidc_user", sub: "viewer-subject" },
    });
    const response = await POST(
      new NextRequest("http://caipe-ui:3000/api/tome/mcp", {
        method: "POST",
        headers: { authorization: "Bearer redacted" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 7 });
    expect(body.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "tome_list_projects" }),
        expect.objectContaining({ name: "tome_create_project" }),
      ]),
    );
  });

  it("returns a JSON-RPC parse error only after interactive authentication", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "viewer@example.test" },
      session: { principalType: "oidc_user", sub: "viewer-subject" },
    });
    const response = await POST(
      new NextRequest("http://caipe-ui:3000/api/tome/mcp", {
        method: "POST",
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: -32700, message: "Parse error" },
    });
  });
});
