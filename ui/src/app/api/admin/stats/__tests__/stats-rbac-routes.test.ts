/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockConnectToDatabase = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(async () => null),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "bob-sub",
    email: "bob@example.com",
    name: "Bob Chat User",
  })),
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
  isMongoDBConfigured: true,
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "GET",
    headers: { Authorization: "Bearer test-token" },
  });
}

async function expectStatsDenied(response: Response): Promise<void> {
  const body = await response.json();
  expect(response.status).toBe(403);
  expect(body.reason).toBe("pdp_denied");
  expect(body.code).toBe("admin_ui#view");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckPermission.mockResolvedValue({ allowed: false, reason: "DENY_NO_CAPABILITY" });
});

describe("admin stats RBAC routes", () => {
  it("denies bearer users without admin_ui#view before loading skill stats", async () => {
    const { GET } = await import("../skills/route");

    const response = await GET(request("/api/admin/stats/skills"));

    await expectStatsDenied(response);
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("denies bearer users without admin_ui#view before loading checkpoint stats", async () => {
    const { GET } = await import("../checkpoints/route");

    const response = await GET(request("/api/admin/stats/checkpoints"));

    await expectStatsDenied(response);
    expect(mockConnectToDatabase).not.toHaveBeenCalled();
  });
});
