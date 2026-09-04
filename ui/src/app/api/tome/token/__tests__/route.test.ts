/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthenticatedUser = jest.fn();
const mockHandleApiError = jest.fn((error: unknown) => {
  const message = error instanceof Error ? error.message : "error";
  return Response.json({ error: message }, { status: 500 });
});
const mockCreateTomeApiKey = jest.fn();
const mockGetActiveTomeApiKey = jest.fn();
const mockRevokeActiveTomeApiKeys = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  handleApiError: (...args: unknown[]) => mockHandleApiError(...args),
}));
jest.mock("@/lib/tome/guard", () => ({ isTomeServerEnabled: () => true }));
jest.mock("@/lib/tome-api-keys", () => ({
  createTomeApiKey: (...args: unknown[]) => mockCreateTomeApiKey(...args),
  getActiveTomeApiKey: (...args: unknown[]) => mockGetActiveTomeApiKey(...args),
  resolveTomeApiKeyOwner: (session: { sub?: unknown }) =>
    typeof session.sub === "string" ? session.sub : null,
  revokeActiveTomeApiKeys: (...args: unknown[]) => mockRevokeActiveTomeApiKeys(...args),
}));

import { DELETE, GET, POST } from "../route";

describe("TOME API token management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthenticatedUser.mockResolvedValue({
      user: { email: "user@example.test", name: "Test User" },
      session: { sub: "user-subject" },
    });
    mockCreateTomeApiKey.mockResolvedValue({
      key: "tome_abc.secret",
      keyId: "tome_abc",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    mockGetActiveTomeApiKey.mockResolvedValue(null);
    mockRevokeActiveTomeApiKeys.mockResolvedValue(true);
  });

  it("mints a token only from a browser session", async () => {
    const response = await POST(
      new NextRequest("http://example.test/api/tome/token", {
        method: "POST",
        body: JSON.stringify({ expires_in_days: 30 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      token: "tome_abc.secret",
      token_type: "ApiKey",
      header_name: "x-caipe-token",
      scope: "tome:mcp",
      expires_in: 30 * 86_400,
    });
    expect(mockCreateTomeApiKey).toHaveBeenCalledWith({
      ownerSub: "user-subject",
      ownerEmail: "user@example.test",
      ownerName: "Test User",
      expiresInDays: 30,
    });
  });

  it("returns metadata without returning the raw token", async () => {
    mockGetActiveTomeApiKey.mockResolvedValue({
      key_id: "tome_abc",
      created_at: new Date("2026-09-01T00:00:00.000Z"),
      expires_at: new Date("2026-12-01T00:00:00.000Z"),
    });
    const response = await GET(
      new NextRequest("http://example.test/api/tome/token"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ has_active_token: true, key_id: "tome_abc" });
    expect(body.token).toBeUndefined();
  });

  it("revokes the current user's token", async () => {
    const response = await DELETE(
      new NextRequest("http://example.test/api/tome/token", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(mockRevokeActiveTomeApiKeys).toHaveBeenCalledWith("user-subject");
  });
});
