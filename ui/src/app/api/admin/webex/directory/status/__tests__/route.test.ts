/** @jest-environment node */

import { NextRequest } from "next/server";

const mockRequireRbacPermission = jest.fn();
const mockCallWebexBotAdmin = jest.fn();
const mockCountDocuments = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: jest.fn(async () => ({
    session: { user: { email: "admin@example.com" } },
  })),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
  successResponse: (data: unknown) => Response.json({ success: true, data }),
  withErrorHandler: (handler: (request: NextRequest) => Promise<Response>) => handler,
}));

jest.mock("@/lib/webex-bot-admin", () => ({
  callWebexBotAdmin: (...args: unknown[]) => mockCallWebexBotAdmin(...args),
}));

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: jest.fn(async () => ({
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
  })),
}));

import { GET } from "../route";

describe("GET /api/admin/webex/directory/status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCountDocuments.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    mockCallWebexBotAdmin.mockImplementation(async (path: string) => {
      if (path === "/admin/webex/routes/status") {
        return {
          route_mode: "db_prefer",
          static_config: { spaces: 2, routes: 3 },
          route_cache: { cache_size: 2 },
          space_discovery: {
            bots: {
              primary: { spaces_indexed: 5, fetched_at: 123 },
              secondary: { spaces_indexed: 2, fetched_at: 125 },
            },
            last_errors: {},
          },
        };
      }
      if (path === "/admin/webex/bots") {
        return {
          bots: [
            { id: "primary", available: true },
            { id: "secondary", available: true },
          ],
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
  });

  it("returns runtime-owned bot and discovery status", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/admin/webex/directory/status",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.bot_admin).toMatchObject({
      reachable: true,
      runtime: {
        route_mode: "db_prefer",
        static_spaces: 2,
        static_routes: 3,
        cache_size: 2,
        bots_available: 2,
      },
    });
    expect(body.data.space_discovery).toMatchObject({
      configured: true,
      status: "ready",
      spaces_indexed: 7,
      fetched_at: 125,
    });
    expect(body.data.platform).toEqual({
      reachable: true,
      spaces_onboarded: 2,
      routes_configured: 3,
    });
  });

  it("keeps platform status available when the bot runtime is unreachable", async () => {
    mockCallWebexBotAdmin.mockRejectedValue(new Error("runtime unavailable"));

    const response = await GET(new NextRequest(
      "http://localhost/api/admin/webex/directory/status",
    ));
    const body = await response.json();

    expect(body.data.configured).toBe(true);
    expect(body.data.bot_admin).toEqual({
      reachable: false,
      error: "runtime unavailable",
    });
    expect(body.data.space_discovery).toMatchObject({
      configured: false,
      status: "empty",
    });
  });
});
