/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockReadOpenFgaTuples = jest.fn();

const storedRelationships = [
  {
    subject: { type: "team", id: "platform", relation: "member" },
    action: "use",
    resource: { type: "agent", id: "incident-agent" },
    source_type: "manual",
    source_id: "change-set-1",
    status: "active",
    created_by: "alice@example.com",
    created_at: "2026-05-12T00:00:00.000Z",
  },
];

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice Admin",
  })),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => ({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(storedRelationships) }),
      toArray: jest.fn().mockResolvedValue(storedRelationships),
    }),
  })),
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: { Authorization: "Bearer test-token" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockReadOpenFgaTuples.mockResolvedValue({
    tuples: [
      {
        key: {
          user: "team:platform#member",
          relation: "can_use",
          object: "agent:incident-agent",
        },
        timestamp: "2026-05-12T00:00:01.000Z",
      },
    ],
  });
});

describe("GET /api/admin/rebac/resources/[type]/[id]/relationships", () => {
  it("returns OpenFGA tuples with relationship provenance for a resource", async () => {
    const { GET } = await import("../resources/[type]/[id]/relationships/route");

    const response = await GET(
      request("/api/admin/rebac/resources/agent/incident-agent/relationships"),
      { params: Promise.resolve({ type: "agent", id: "incident-agent" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith({
      tuple: { object: "agent:incident-agent" },
      pageSize: 100,
    });
    expect(body.data.relationships[0]).toMatchObject({
      tuple: {
        user: "team:platform#member",
        relation: "can_use",
        object: "agent:incident-agent",
      },
      provenance: {
        source_type: "manual",
        source_id: "change-set-1",
      },
    });
  });
});
