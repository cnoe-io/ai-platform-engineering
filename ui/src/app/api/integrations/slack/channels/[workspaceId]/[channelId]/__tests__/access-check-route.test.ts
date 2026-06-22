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

describe("Slack runtime access-check route", () => {
  beforeEach(() => {
    jest.resetModules();
    mockCheckPermission.mockReset();
    mockCheckOpenFgaTuple.mockReset();
    mockCheckUniversalRebacRelationship.mockReset();
  });

  // The bot only checks the channel→agent grant. User-level can_use is enforced
  // downstream by the conversation creation API, not here.
  it("allows when channel grant exists", async () => {
    mockCheckUniversalRebacRelationship
      .mockResolvedValueOnce({ allowed: true }); // channel→agent
    const { POST } = await import("../access-check/route");

    const response = await POST(
      request("/api/integrations/slack/channels/T123456789/C123456789/access-check", {
        method: "POST",
        body: JSON.stringify({
          resource: { type: "agent", id: "incident-agent" },
          action: "use",
        }),
      }),
      { params: Promise.resolve({ workspaceId: "T123456789", channelId: "C123456789" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      allowed: true,
      channel_allowed: true,
      reason: "allowed",
    });
    expect(mockCheckPermission).not.toHaveBeenCalled();
  });

  it("denies when channel grant is missing", async () => {
    mockCheckUniversalRebacRelationship
      .mockResolvedValueOnce({ allowed: false }); // channel→agent denied
    const { POST } = await import("../access-check/route");

    const response = await POST(
      request("/api/integrations/slack/channels/T123456789/C123456789/access-check", {
        method: "POST",
        body: JSON.stringify({
          resource: { type: "agent", id: "incident-agent" },
          action: "use",
        }),
      }),
      { params: Promise.resolve({ workspaceId: "T123456789", channelId: "C123456789" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      allowed: false,
      channel_allowed: false,
      reason: "missing_channel_grant",
    });
  });
});
