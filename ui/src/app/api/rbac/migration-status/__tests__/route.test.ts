/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetMigrationBlockingStatus = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
  successResponse: (data: unknown) => Response.json({ success: true, data }),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/rbac/migrations/registry", () => ({
  getMigrationBlockingStatus: (...args: unknown[]) => mockGetMigrationBlockingStatus(...args),
}));

import { GET } from "../route";

function request(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/rbac/migration-status"));
}

describe("GET /api/rbac/migration-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "admin@example.com" },
      session: { sub: "admin-sub" },
    });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockGetMigrationBlockingStatus.mockResolvedValue({ is_blocking: false });
  });

  it("requires admin UI access before exposing migration status", async () => {
    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      { sub: "admin-sub" },
      "admin_ui",
      "admin",
    );
    expect(mockGetMigrationBlockingStatus).toHaveBeenCalledWith({ actor: "admin@example.com" });
  });
});
