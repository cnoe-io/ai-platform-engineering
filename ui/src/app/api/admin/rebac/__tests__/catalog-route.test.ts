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

const mockCollections: Record<string, any> = {};

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection([])),
}));

function createMockCollection(rows: unknown[]) {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) }),
        toArray: jest.fn().mockResolvedValue(rows),
      }),
      limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) }),
      toArray: jest.fn().mockResolvedValue(rows),
    }),
  };
}

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
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockGetServerSession.mockResolvedValue({
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    accessToken: accessTokenWithRoles(["admin"]),
  });
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockCollections.teams = createMockCollection([{ _id: "team-1", slug: "platform", name: "Platform" }]);
  mockCollections.dynamic_agents = createMockCollection([
    { _id: "agent-1", name: "Incident Agent", enabled: true },
  ]);
});

describe("GET /api/admin/rebac/catalog", () => {
  it("returns every universal resource type, action map, and resource instances", async () => {
    const { GET } = await import("../catalog/route");

    const response = await GET(makeRequest("/api/admin/rebac/catalog"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.resource_types.map((item: any) => item.type)).toEqual(
      listResourceTypeDefinitions().map((definition) => definition.type)
    );
    expect(body.data.actions.tool).toContain("call");
    expect(body.data.actions.knowledge_base).toContain("ingest");

    const representedTypes = new Set(body.data.resources.map((resource: any) => resource.type));
    for (const definition of listResourceTypeDefinitions()) {
      expect(representedTypes).toContain(definition.type);
    }
  });

  it("filters catalog resources by type", async () => {
    const { GET } = await import("../catalog/route");

    const response = await GET(makeRequest("/api/admin/rebac/catalog?type=agent"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.resources.length).toBeGreaterThan(0);
    expect(body.data.resources.every((resource: any) => resource.type === "agent")).toBe(true);
  });
});
