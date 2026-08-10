/**
 * @jest-environment node
 */

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockListRebacEnforcementStatuses = jest.fn();
const mockCheckUniversalRebacRelationship = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
  successResponse: (data: unknown, init?: ResponseInit) => Response.json({ success: true, data }, init),
  withErrorHandler:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
        return Response.json({ success: false, error: (error as Error).message }, { status });
      }
    },
}));

jest.mock("@/lib/rbac/enforcement-status", () => ({
  listRebacEnforcementStatuses: () => mockListRebacEnforcementStatuses(),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkUniversalRebacRelationship: (...args: unknown[]) => mockCheckUniversalRebacRelationship(...args),
}));

describe("POST /api/rbac/enforcement-comparison", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "admin@example.com" },
      session: { sub: "admin-sub" },
    });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockListRebacEnforcementStatuses.mockResolvedValue([
      { resource_type: "agent", enforcement_status: "rebac_enforced", surface: "agent" },
    ]);
    mockCheckUniversalRebacRelationship.mockResolvedValue({ allowed: true });
  });

  it("compares stale realm roles against ReBAC for enforced resource types", async () => {
    const { POST } = await import("../enforcement-comparison/route");

    const response = await POST(
      new Request("http://localhost/api/rbac/enforcement-comparison", {
        method: "POST",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: { type: "user", id: "alice" },
          action: "use",
          resource: { type: "agent", id: "incident-agent" },
          realm_roles: ["agent_user:incident-agent"],
        }),
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireRbacPermission).toHaveBeenCalledWith({ sub: "admin-sub" }, "admin_ui", "view");
    expect(body.data).toMatchObject({
      enforcement_status: "rebac_enforced",
      legacy: {
        allowed: false,
        ignored_roles: ["agent_user:incident-agent"],
      },
      rebac: {
        allowed: true,
      },
      effective: {
        allowed: true,
        source: "rebac",
      },
    });
  });
});
