/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

import { listResourceTypeDefinitions } from "@/lib/rbac/resource-model";

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

const mockRows: unknown[] = [];

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => ({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(mockRows) }),
      toArray: jest.fn().mockResolvedValue(mockRows),
    }),
  })),
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
  mockRows.splice(0, mockRows.length);
  mockGetServerSession.mockResolvedValue({
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    accessToken: accessTokenWithRoles(["admin"]),
  });
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
});

describe("GET /api/admin/rebac/enforcement-status", () => {
  it("returns a default status for every universal resource type", async () => {
    const { GET } = await import("../enforcement-status/route");

    const response = await GET(makeRequest("/api/admin/rebac/enforcement-status"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.statuses.map((item: any) => item.resource_type)).toEqual(
      listResourceTypeDefinitions().map((definition) => definition.type)
    );
    expect(body.data.statuses.every((item: any) => item.enforcement_status)).toBe(true);
  });

  it("merges stored overrides into default enforcement status", async () => {
    mockRows.push({
      resource_type: "agent",
      enforcement_status: "rebac_enforced",
      surface: "dynamic_agents",
      updated_by: "admin@example.com",
      updated_at: "2026-05-12T00:00:00.000Z",
    });
    const { GET } = await import("../enforcement-status/route");

    const response = await GET(makeRequest("/api/admin/rebac/enforcement-status"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.statuses.find((item: any) => item.resource_type === "agent")).toEqual(
      expect.objectContaining({
        enforcement_status: "rebac_enforced",
        surface: "dynamic_agents",
      })
    );
  });
});
