/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCallWebexBotAdmin = jest.fn();

jest.mock("@/lib/webex-bot-admin", () => ({
  callWebexBotAdmin: (...args: unknown[]) => mockCallWebexBotAdmin(...args),
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice",
  })),
}));

jest.mock("@/lib/config", () => ({ getConfig: () => true }));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCallWebexBotAdmin.mockResolvedValue({ ok: true });
});

describe("POST /api/admin/webex/runtime/reload", () => {
  it("rejects unexpected payload fields", async () => {
    const { POST } = await import("../reload/route");

    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/webex/runtime/reload", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dry_run: true, force: true }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockCallWebexBotAdmin).not.toHaveBeenCalled();
  });

  it("proxies allowlisted dry_run payload", async () => {
    const { POST } = await import("../reload/route");

    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/webex/runtime/reload", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dry_run: false }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockCallWebexBotAdmin).toHaveBeenCalledWith("/admin/webex/routes/reload", {
      method: "POST",
      body: { dry_run: false },
    });
  });
});
