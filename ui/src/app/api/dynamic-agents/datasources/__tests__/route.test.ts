/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockListTeamKbGrants = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  successResponse: (data: unknown) => Response.json({ success: true, data }),
  withErrorHandler:
    <T,>(handler: (request: NextRequest) => Promise<T>) =>
    async (request: NextRequest) => handler(request),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/rbac/team-resource-listing", () => ({
  listTeamKbGrants: (...args: unknown[]) => mockListTeamKbGrants(...args),
}));

const session = { sub: "alice-sub", accessToken: "token-123" };
const user = { email: "alice@example.com" };

describe("GET /api/dynamic-agents/datasources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireResourcePermission.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        datasources: [
          { datasource_id: "kb-1", name: "Runbooks" },
          { datasource_id: "kb-2", name: "Support Docs" },
        ],
      }),
    });
  });

  it("returns an empty list when no team_slug is provided", async () => {
    const { GET } = await import("../route");
    const response = await GET(new NextRequest("http://localhost/api/dynamic-agents/datasources"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ datasources: [] });
    expect(mockListTeamKbGrants).not.toHaveBeenCalled();
  });

  it("joins the team's KB grants with RAG server display names", async () => {
    mockListTeamKbGrants.mockResolvedValue({
      kbIds: ["kb-1", "kb-2"],
      permissions: { "kb-1": "reader", "kb-2": "manager" },
    });

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest("http://localhost/api/dynamic-agents/datasources?team_slug=platform"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockListTeamKbGrants).toHaveBeenCalledWith("platform");
    expect(body.data.datasources).toEqual([
      { datasource_id: "kb-1", name: "Runbooks", permission: "reader" },
      { datasource_id: "kb-2", name: "Support Docs", permission: "manager" },
    ]);
  });

  it("falls back to raw ids when the RAG server lookup fails", async () => {
    mockListTeamKbGrants.mockResolvedValue({
      kbIds: ["kb-9"],
      permissions: { "kb-9": "reader" },
    });
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest("http://localhost/api/dynamic-agents/datasources?team_slug=platform"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.datasources).toEqual([
      { datasource_id: "kb-9", name: "kb-9", permission: "reader" },
    ]);
  });

  it("falls back to the manage permission check when use is denied", async () => {
    mockRequireResourcePermission
      .mockRejectedValueOnce(new Error("cannot use"))
      .mockResolvedValueOnce(undefined);
    mockListTeamKbGrants.mockResolvedValue({ kbIds: [], permissions: {} });

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest("http://localhost/api/dynamic-agents/datasources?team_slug=platform"),
    );

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenNthCalledWith(1, session, {
      type: "team",
      id: "platform",
      action: "use",
    });
    expect(mockRequireResourcePermission).toHaveBeenNthCalledWith(2, session, {
      type: "team",
      id: "platform",
      action: "manage",
    });
  });

  it("propagates the error when neither use nor manage is permitted", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("forbidden"));

    const { GET } = await import("../route");
    await expect(
      GET(new NextRequest("http://localhost/api/dynamic-agents/datasources?team_slug=platform")),
    ).rejects.toThrow("forbidden");
    expect(mockListTeamKbGrants).not.toHaveBeenCalled();
  });
});
