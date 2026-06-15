/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockCheckUniversalRebacRelationship = jest.fn();

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  checkUniversalRebacRelationship: (...args: unknown[]) =>
    mockCheckUniversalRebacRelationship(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: async (
    session: { sub?: string },
    target: { type: string; id: string; action: string },
    options?: { bypassForOrgAdmin?: boolean },
  ) => {
    if (options?.bypassForOrgAdmin) {
      const org = await mockCheckOpenFgaTuple({
        user: `user:${session.sub}`,
        relation: "can_manage",
        object: "organization:caipe",
      });
      if (org.allowed) return;
    }
    const result = await mockCheckOpenFgaTuple({
      user: `user:${session.sub}`,
      relation: `can_${target.action}`,
      object: `${target.type}:${target.id}`,
    });
    if (!result.allowed) {
      throw {
        message: "You do not have permission to access this resource.",
        statusCode: 403,
        code: `${target.type}#${target.action}`,
      };
    }
  },
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice User",
  })),
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(async () => null),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: {
      Authorization: "Bearer user-obo-token",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("Webex runtime access-check route", () => {
  beforeEach(() => {
    jest.resetModules();
    mockCheckPermission.mockReset();
    mockCheckOpenFgaTuple.mockReset();
    mockCheckUniversalRebacRelationship.mockReset();
  });

  it("checks space and user grants without requiring admin UI permission", async () => {
    mockCheckPermission.mockResolvedValue({ allowed: false, reason: "denied" });
    mockCheckOpenFgaTuple
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true });
    mockCheckUniversalRebacRelationship
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: true });
    const { POST } = await import("../access-check/route");

    const response = await POST(
      request("/api/integrations/webex/spaces/CAIPE-WEBEX/space-abc/access-check", {
        method: "POST",
        body: JSON.stringify({
          user_subject: "team:platform-engineering#member",
          resource: { type: "agent", id: "incident-agent" },
          action: "use",
        }),
      }),
      { params: Promise.resolve({ workspaceId: "CAIPE-WEBEX", spaceId: "space-abc" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      allowed: true,
      space_allowed: true,
      user_allowed: true,
      reason: "allowed",
    });
    expect(mockCheckPermission).not.toHaveBeenCalled();
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:alice-sub",
      relation: "can_read",
      object: "webex_space:CAIPE-WEBEX--space-abc",
    });
  });

  it("denies before evaluating grants when caller cannot read the space", async () => {
    mockCheckPermission.mockResolvedValue({ allowed: false, reason: "denied" });
    mockCheckOpenFgaTuple
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: false });
    const { POST } = await import("../access-check/route");

    const response = await POST(
      request("/api/integrations/webex/spaces/CAIPE-WEBEX/space-abc/access-check", {
        method: "POST",
        body: JSON.stringify({
          user_subject: "team:platform-engineering#member",
          resource: { type: "agent", id: "incident-agent" },
          action: "use",
        }),
      }),
      { params: Promise.resolve({ workspaceId: "CAIPE-WEBEX", spaceId: "space-abc" }) }
    );

    expect(response.status).toBe(403);
    expect(mockCheckUniversalRebacRelationship).not.toHaveBeenCalled();
  });
});
