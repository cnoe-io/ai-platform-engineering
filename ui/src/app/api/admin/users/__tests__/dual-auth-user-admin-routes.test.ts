/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockGetRealmUserById = jest.fn();
const mockGetRoleByName = jest.fn();
const mockAssignRealmRolesToUser = jest.fn();
const mockRemoveRealmRolesFromUser = jest.fn();
const mockGetCollection = jest.fn();

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

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  getRealmUserById: (...args: unknown[]) => mockGetRealmUserById(...args),
  getRoleByName: (...args: unknown[]) => mockGetRoleByName(...args),
  assignRealmRolesToUser: (...args: unknown[]) => mockAssignRealmRolesToUser(...args),
  removeRealmRolesFromUser: (...args: unknown[]) => mockRemoveRealmRolesFromUser(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function expectDenied(response: Response, capability: string): Promise<void> {
  const body = await response.json();
  expect(response.status).toBe(403);
  expect(body.reason).toBe("pdp_denied");
  expect(body.code).toBe(capability);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckPermission.mockResolvedValue({ allowed: false, reason: "DENY_NO_CAPABILITY" });
  mockGetCollection.mockResolvedValue({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    findOne: jest.fn().mockResolvedValue({ email: "alice@example.com" }),
  });
});

describe("admin user sibling routes dual-auth PDP gates", () => {
  it("denies bearer users without admin_ui#admin before mutating team membership", async () => {
    const { POST } = await import("../[id]/teams/route");

    const response = await POST(
      request("/api/admin/users/user-1/teams", {
        method: "POST",
        body: JSON.stringify({ teamId: "team-1" }),
      }),
      { params: Promise.resolve({ id: "user-1" }) }
    );

    await expectDenied(response, "admin_ui#admin");
    expect(mockGetRealmUserById).not.toHaveBeenCalled();
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("denies bearer users without admin_ui#admin before assigning realm roles", async () => {
    const { POST } = await import("../[id]/roles/route");

    const response = await POST(
      request("/api/admin/users/user-1/roles", {
        method: "POST",
        body: JSON.stringify({ roles: [{ name: "admin" }] }),
      }),
      { params: Promise.resolve({ id: "user-1" }) }
    );

    await expectDenied(response, "admin_ui#admin");
    expect(mockGetRoleByName).not.toHaveBeenCalled();
    expect(mockAssignRealmRolesToUser).not.toHaveBeenCalled();
  });

  it("denies bearer users without admin_ui#admin before removing realm roles", async () => {
    const { DELETE } = await import("../[id]/roles/route");

    const response = await DELETE(
      request("/api/admin/users/user-1/roles", {
        method: "DELETE",
        body: JSON.stringify({ roles: [{ name: "admin" }] }),
      }),
      { params: Promise.resolve({ id: "user-1" }) }
    );

    await expectDenied(response, "admin_ui#admin");
    expect(mockGetRoleByName).not.toHaveBeenCalled();
    expect(mockRemoveRealmRolesFromUser).not.toHaveBeenCalled();
  });

  it("denies bearer users without admin_ui#admin before updating legacy Mongo role", async () => {
    const { PATCH } = await import("../[id]/role/route");

    const response = await PATCH(
      request("/api/admin/users/user-1/role", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      }),
      { params: Promise.resolve({ id: "user-1" }) }
    );

    await expectDenied(response, "admin_ui#admin");
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed legacy Mongo role update JSON", async () => {
    mockCheckPermission.mockResolvedValueOnce({ allowed: true, reason: "OK" });
    const { PATCH } = await import("../[id]/role/route");

    const response = await PATCH(
      request("/api/admin/users/user-1/role", {
        method: "PATCH",
        body: "{",
      }),
      { params: Promise.resolve({ id: "user-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("denies bearer users without admin_ui#view before loading activity stats", async () => {
    const { GET } = await import("../stats/route");

    const response = await GET(request("/api/admin/users/stats", { method: "GET" }));

    await expectDenied(response, "admin_ui#view");
    expect(mockGetCollection).not.toHaveBeenCalled();
  });
});
