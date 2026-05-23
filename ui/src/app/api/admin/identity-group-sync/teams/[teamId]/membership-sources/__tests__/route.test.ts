/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockListTeamMembershipSources = jest.fn();

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

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  listTeamMembershipSources: (...args: unknown[]) => mockListTeamMembershipSources(...args),
}));

let mockIsMongoDBConfigured = true;
jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
}));

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

function accessTokenWithRoles(roles: string[]): string {
  const payload = Buffer.from(JSON.stringify({ realm_access: { roles } }), "utf8").toString(
    "base64url"
  );
  return `h.${payload}.s`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockGetServerSession.mockResolvedValue({
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    accessToken: accessTokenWithRoles(["admin"]),
  });
  mockListTeamMembershipSources.mockResolvedValue([
    {
      team_id: "team-1",
      team_slug: "platform",
      user_email: "member@example.com",
      relationship: "member",
      source_type: "manual",
      managed: false,
      status: "active",
      created_at: "2026-05-12T00:00:00.000Z",
    },
  ]);
});

describe("GET /api/admin/identity-group-sync/teams/[teamId]/membership-sources", () => {
  it("returns membership sources for authorized viewers", async () => {
    const { GET } = await import("../route");

    const response = await GET(
      makeRequest("/api/admin/identity-group-sync/teams/team-1/membership-sources"),
      { params: Promise.resolve({ teamId: "team-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockListTeamMembershipSources).toHaveBeenCalledWith("team-1");
    expect(body.data.sources).toEqual([
      expect.objectContaining({ source_type: "manual", managed: false }),
    ]);
  });

  it("returns 503 when MongoDB is unavailable", async () => {
    mockIsMongoDBConfigured = false;
    const { GET } = await import("../route");

    const response = await GET(
      makeRequest("/api/admin/identity-group-sync/teams/team-1/membership-sources"),
      { params: Promise.resolve({ teamId: "team-1" }) }
    );

    expect(response.status).toBe(503);
  });
});
