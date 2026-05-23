/**
 * @jest-environment node
 */

const mockRequireRbacPermission = jest.fn();
const mockGetAuthFromBearerOrSession = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
      public code?: string
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    withErrorHandler:
      <T,>(handler: (request: Request, context?: unknown) => Promise<T>) =>
      async (request: Request, context?: unknown) => {
        try {
          return await handler(request, context);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "error" },
            { status: (error as { statusCode?: number }).statusCode ?? 500 }
          );
        }
      },
  };
});

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => {
    throw new Error("Mongo unavailable in diagnostics test");
  }),
}));

describe("GET /api/admin/openfga/baseline-diagnostics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_ORG_KEY = "grid";
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "admin@example.com" },
      session: { sub: "admin-sub", user: { email: "admin@example.com" } },
    });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { relation: string; object: string }) => ({
      allowed:
        tuple.object === "organization:grid" && tuple.relation === "can_use" ||
        tuple.object === "system_config:platform_settings" && tuple.relation === "can_read" ||
        tuple.object === "user_profile:bob-sub" && tuple.relation === "can_read" ||
        tuple.object.startsWith("admin_surface:") && tuple.relation === "can_read",
    }));
  });

  it("compares actual user access against member and admin baselines", async () => {
    const { GET } = await import("../baseline-diagnostics/route");

    const response = await GET(new Request("http://localhost/api/admin/openfga/baseline-diagnostics?userId=bob-sub") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user_id).toBe("bob-sub");
    expect(body.data.summary.member_drift).toBe(0);
    expect(body.data.summary.admin_drift).toBeGreaterThan(0);
    expect(body.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "member-admin-surface:metrics:read",
          actual: true,
          expected_member: true,
          expected_admin: true,
        }),
        expect.objectContaining({
          id: "admin-organization-admin",
          actual: false,
          expected_member: false,
          expected_admin: true,
        }),
        expect.objectContaining({
          id: "admin-agentgateway-manage",
          actual: false,
          expected_member: false,
          expected_admin: true,
        }),
      ])
    );
  });
});
