/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockCheckUniversalRebacRelationship = jest.fn();

const provenanceRows = [
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
  checkUniversalRebacRelationship: (...args: unknown[]) =>
    mockCheckUniversalRebacRelationship(...args),
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
  logAccessCheckAuditEvent: jest.fn(),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => ({
    findOne: jest.fn(async () => provenanceRows[0]),
  })),
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

const relationship = {
  subject: { type: "team", id: "platform", relation: "member" },
  action: "use",
  resource: { type: "agent", id: "incident-agent" },
};

function request(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/rebac/check", "http://localhost:3000"), {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
});

describe("POST /api/admin/rebac/check", () => {
  it("explains allow outcomes with provenance", async () => {
    mockCheckUniversalRebacRelationship.mockResolvedValue({ allowed: true });
    const { POST } = await import("../check/route");

    const response = await POST(request({ relationship }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.allowed).toBe(true);
    expect(body.data.explanation.reason).toBe("relationship_allowed");
    expect(body.data.explanation.path[0]).toMatchObject({
      source_type: "manual",
      source_id: "change-set-1",
    });
  });

  it("explains deny outcomes with missing prerequisites", async () => {
    mockCheckUniversalRebacRelationship.mockResolvedValue({ allowed: false });
    const { POST } = await import("../check/route");

    const response = await POST(request({ relationship }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.allowed).toBe(false);
    expect(body.data.explanation.reason).toBe("missing_allow_relationship");
    expect(body.data.explanation.missing).toContain(
      "team:platform#member can_use agent:incident-agent"
    );
  });
});
