/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckUniversalRebacRelationship = jest.fn();

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: jest.fn(),
  checkUniversalRebacRelationship: (...args: unknown[]) =>
    mockCheckUniversalRebacRelationship(...args),
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
    mockCheckUniversalRebacRelationship.mockReset();
  });

  it("checks space grant only (user can_use is enforced by conversations API)", async () => {
    mockCheckUniversalRebacRelationship.mockResolvedValueOnce({ allowed: true });
    const { POST } = await import("../access-check/route");

    const response = await POST(
      request("/api/integrations/webex/spaces/CAIPE-WEBEX/space-abc/access-check", {
        method: "POST",
        body: JSON.stringify({
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
      reason: "allowed",
    });
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledTimes(1);
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledWith({
      subject: { type: "webex_space", id: "CAIPE-WEBEX--space-abc" },
      action: "use",
      resource: { type: "agent", id: "incident-agent" },
    });
  });

  it("denies when the space grant is missing", async () => {
    mockCheckUniversalRebacRelationship.mockResolvedValueOnce({ allowed: false });
    const { POST } = await import("../access-check/route");

    const response = await POST(
      request("/api/integrations/webex/spaces/CAIPE-WEBEX/space-abc/access-check", {
        method: "POST",
        body: JSON.stringify({
          resource: { type: "agent", id: "incident-agent" },
          action: "use",
        }),
      }),
      { params: Promise.resolve({ workspaceId: "CAIPE-WEBEX", spaceId: "space-abc" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      allowed: false,
      space_allowed: false,
      reason: "missing_space_grant",
    });
  });
});
