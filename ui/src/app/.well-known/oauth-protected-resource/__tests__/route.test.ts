/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockIsTomeServerEnabled = jest.fn();

jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => mockIsTomeServerEnabled(),
}));

import { GET as getRootMetadata } from "../route";
import { GET as getPathMetadata } from "../[...path]/route";

const originalTomePublicOrigin = process.env.TOME_PUBLIC_ORIGIN;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;
const originalTomeIssuer = process.env.TOME_MCP_OAUTH_ISSUER;
const originalOidcIssuer = process.env.OIDC_ISSUER;

describe("Tome MCP protected-resource metadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTomeServerEnabled.mockReturnValue(true);
    process.env.TOME_PUBLIC_ORIGIN = "https://grid.example.test";
    process.env.TOME_MCP_OAUTH_ISSUER =
      "https://idp.example.test/realms/example/";
    delete process.env.NEXTAUTH_URL;
    delete process.env.OIDC_ISSUER;
  });

  afterAll(() => {
    if (originalTomePublicOrigin === undefined)
      delete process.env.TOME_PUBLIC_ORIGIN;
    else process.env.TOME_PUBLIC_ORIGIN = originalTomePublicOrigin;
    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextAuthUrl;
    if (originalTomeIssuer === undefined)
      delete process.env.TOME_MCP_OAUTH_ISSUER;
    else process.env.TOME_MCP_OAUTH_ISSUER = originalTomeIssuer;
    if (originalOidcIssuer === undefined) delete process.env.OIDC_ISSUER;
    else process.env.OIDC_ISSUER = originalOidcIssuer;
  });

  async function expectMetadata(response: Response) {
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: "https://grid.example.test/api/tome/mcp",
      authorization_servers: ["https://idp.example.test/realms/example"],
      bearer_methods_supported: ["header"],
      scopes_supported: [
        "openid",
        "profile",
        "email",
        "roles",
        "groups",
        "org",
        "offline_access",
      ],
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  }

  it("serves root discovery metadata", async () => {
    await expectMetadata(
      await getRootMetadata(
        new NextRequest(
          "https://grid.example.test/.well-known/oauth-protected-resource",
        ),
      ),
    );
  });

  it("serves the Tome resource-specific discovery alias", async () => {
    await expectMetadata(
      await getPathMetadata(
        new NextRequest(
          "https://grid.example.test/.well-known/oauth-protected-resource/api/tome/mcp",
        ),
        { params: Promise.resolve({ path: ["api", "tome", "mcp"] }) },
      ),
    );
  });

  it("does not advertise metadata for unrelated protected-resource paths", async () => {
    const response = await getPathMetadata(
      new NextRequest(
        "https://grid.example.test/.well-known/oauth-protected-resource/another/service",
      ),
      { params: Promise.resolve({ path: ["another", "service"] }) },
    );

    expect(response.status).toBe(404);
  });

  it("keeps discovery hidden when Tome is disabled", async () => {
    mockIsTomeServerEnabled.mockReturnValue(false);

    const response = await getPathMetadata(
      new NextRequest(
        "https://grid.example.test/.well-known/oauth-protected-resource/api/tome/mcp",
      ),
      { params: Promise.resolve({ path: ["api", "tome", "mcp"] }) },
    );

    expect(response.status).toBe(404);
  });
});
