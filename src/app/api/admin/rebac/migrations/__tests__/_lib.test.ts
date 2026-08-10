/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockIsBootstrapAdmin = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  isBootstrapAdmin: (...args: unknown[]) => mockIsBootstrapAdmin(...args),
}));

function request(): NextRequest {
  return new NextRequest(new URL("/api/admin/rebac/migrations", "http://localhost:3000"));
}

describe("requireMigrationAdmin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireRbacPermission.mockResolvedValue(undefined);
  });

  it("allows bootstrap admins without requiring a cached access token", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValueOnce({
      user: { email: "admin@example.com", name: "Admin", role: "admin" },
      session: {
        user: { email: "admin@example.com" },
        role: "admin",
      },
    });
    mockIsBootstrapAdmin.mockReturnValueOnce(true);

    const { requireMigrationAdmin } = await import("../_lib");

    await expect(requireMigrationAdmin(request())).resolves.toMatchObject({
      user: { email: "admin@example.com" },
    });
    expect(mockRequireRbacPermission).not.toHaveBeenCalled();
  });

  it("keeps OpenFGA authorization for non-bootstrap admins", async () => {
    const session = {
      accessToken: "access-token",
      sub: "user-sub",
      user: { email: "admin@example.com" },
      role: "admin",
    };
    mockGetAuthFromBearerOrSession.mockResolvedValueOnce({
      user: { email: "admin@example.com", name: "Admin", role: "admin" },
      session,
    });
    mockIsBootstrapAdmin.mockReturnValueOnce(false);

    const { requireMigrationAdmin } = await import("../_lib");

    await requireMigrationAdmin(request());

    expect(mockRequireRbacPermission).toHaveBeenCalledWith(session, "admin_ui", "admin");
  });
});
