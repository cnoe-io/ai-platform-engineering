/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

function accessTokenWithRoles(roles: string[]): string {
  const payload = Buffer.from(JSON.stringify({ realm_access: { roles } }), "utf8").toString(
    "base64url"
  );
  return `h.${payload}.s`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    accessToken: accessTokenWithRoles(["admin"]),
  });
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
});

describe("GET /api/admin/rebac/policies/catalog", () => {
  it("returns the shared authorization policy manifest", async () => {
    // assisted-by Codex Codex-sonnet-4-6
    const { GET } = await import("../policies/catalog/route");

    const response = await GET(makeRequest("/api/admin/rebac/policies/catalog"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.count).toBeGreaterThanOrEqual(2);
    expect(body.data.policies.map((policy: any) => policy.id)).toEqual(
      expect.arrayContaining(["slack_channel_team_assignment_v1", "webex_space_team_assignment_v1"])
    );
  });

  it("filters policies by surface and family", async () => {
    const { GET } = await import("../policies/catalog/route");

    const response = await GET(
      makeRequest("/api/admin/rebac/policies/catalog?surface=slack&family=messaging_team_assignment")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.policies.map((policy: any) => policy.id)).toEqual([
      "slack_channel_team_assignment_v1",
    ]);
    expect(body.data.filters).toMatchObject({
      surface: "slack",
      family: "messaging_team_assignment",
    });
  });
});
