/** @jest-environment node */

import { NextRequest } from "next/server";

const mockRequireRbacPermission = jest.fn();
const mockCallWebexBotAdmin = jest.fn();
const mockGetWebexSpaceDiscoveryStatus = jest.fn();
const mockWarmWebexSpaceDiscovery = jest.fn();
const mockCountDocuments = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: jest.fn(async () => ({ session: { user: { email: "admin@test" } } })),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
  successResponse: (data: unknown) => Response.json({ success: true, data }),
  withErrorHandler: (handler: (req: NextRequest) => Promise<Response>) => handler,
}));

jest.mock("@/lib/webex-bot-admin", () => ({
  callWebexBotAdmin: (...args: unknown[]) => mockCallWebexBotAdmin(...args),
}));

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: jest.fn(async () => ({
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
  })),
}));

jest.mock("../../../available-spaces/route", () => ({
  warmWebexSpaceDiscovery: (...args: unknown[]) => mockWarmWebexSpaceDiscovery(...args),
  getWebexSpaceDiscoveryStatus: (...args: unknown[]) => mockGetWebexSpaceDiscoveryStatus(...args),
}));

import { GET } from "../route";

describe("GET /api/admin/webex/directory/status", () => {
  const originalToken = process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCountDocuments
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    mockCallWebexBotAdmin.mockResolvedValue({
      route_mode: "db_prefer",
      static_config: { spaces: 2, routes: 3 },
      route_cache: { cache_size: 2 },
    });
    mockGetWebexSpaceDiscoveryStatus.mockResolvedValue({
      status: "ready",
      spaces_indexed: 5,
      fetched_at: 1,
      updated_at: 2,
      started_at: 1,
      ttl_seconds: 3600,
      last_error: undefined,
    });
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
    } else {
      process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = originalToken;
    }
  });

  it("returns bot admin runtime and space discovery status when configured", async () => {
    process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "integration-token";

    const res = await GET(new NextRequest("http://localhost/api/admin/webex/directory/status"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.configured).toBe(true);
    expect(body.data.bot_admin.reachable).toBe(true);
    expect(body.data.bot_admin.runtime).toEqual({
      route_mode: "db_prefer",
      static_spaces: 2,
      static_routes: 3,
      cache_size: 2,
    });
    expect(body.data.space_discovery).toMatchObject({
      configured: true,
      status: "ready",
      spaces_indexed: 5,
    });
    expect(body.data.platform).toEqual({
      reachable: true,
      spaces_onboarded: 2,
      routes_configured: 3,
    });
    expect(mockWarmWebexSpaceDiscovery).toHaveBeenCalledWith("integration-token");
  });

  it("reports configured when platform routes exist without integration token", async () => {
    delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
    mockCallWebexBotAdmin.mockRejectedValue(new Error("Webex bot admin request failed: 502"));

    const res = await GET(new NextRequest("http://localhost/api/admin/webex/directory/status"));
    const body = await res.json();

    expect(body.data.configured).toBe(true);
    expect(body.data.platform.spaces_onboarded).toBe(2);
    expect(body.data.bot_admin.reachable).toBe(false);
  });

  it("returns partial status when integration token is unset but bot admin is reachable", async () => {
    delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;

    const res = await GET(new NextRequest("http://localhost/api/admin/webex/directory/status"));
    const body = await res.json();

    expect(body.data.configured).toBe(true);
    expect(body.data.space_discovery.configured).toBe(false);
    expect(body.data.space_discovery.status).toBe("empty");
    expect(mockWarmWebexSpaceDiscovery).not.toHaveBeenCalled();
  });

  it("surfaces bot admin errors without failing the whole response", async () => {
    delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
    mockCallWebexBotAdmin.mockRejectedValue(
      new Error("WEBEX_BOT_ADMIN_CLIENT_SECRET (or OIDC_CLIENT_SECRET) is not configured")
    );
    mockCountDocuments.mockReset();
    mockCountDocuments.mockResolvedValue(0);

    const res = await GET(new NextRequest("http://localhost/api/admin/webex/directory/status"));
    const body = await res.json();

    expect(body.data.configured).toBe(false);
    expect(body.data.bot_admin).toEqual({
      reachable: false,
      error: "WEBEX_BOT_ADMIN_CLIENT_SECRET (or OIDC_CLIENT_SECRET) is not configured",
    });
  });
});
