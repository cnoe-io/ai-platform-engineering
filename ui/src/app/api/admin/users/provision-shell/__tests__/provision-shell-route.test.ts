/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/users/provision-shell (issue #1781) — the
 * canonical JIT shell-user provisioning endpoint the Slack bot calls.
 *
 * Covers:
 *  - the bot service account (graphed `service_account:<sub>`) is authorized
 *    via `writer admin_surface:user_provisioning` and provisions a user;
 *  - an org admin passes via the bypass;
 *  - a caller with no grant is denied 403;
 *  - request validation (missing/invalid email, missing source);
 *  - server-owned attributes (`created_by`/`created_at`) cannot be forged;
 *  - the response echoes {sub, created} from the canonical lib function.
 */

import { NextRequest } from "next/server";

const mockCheckOpenFgaTuple = jest.fn();
const mockProvisionShellUser = jest.fn();

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
    sub: "slack-bot-sub",
    email: "service-account-slack-bot@local",
    name: "Slack Bot Service Account",
    isServiceAccount: true,
  })),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  provisionShellUser: (...args: unknown[]) => mockProvisionShellUser(...args),
}));

function request(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/users/provision-shell", "http://localhost:3000"), {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      "X-Client-Source": "slack-bot",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: deny everything; individual tests grant what they need.
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
  mockProvisionShellUser.mockResolvedValue({ sub: "new-kc-uuid", created: true });
});

describe("POST /api/admin/users/provision-shell", () => {
  it("provisions for the bot SA with writer admin_surface:user_provisioning", async () => {
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "service_account:slack-bot-sub" &&
        tuple.relation === "can_write" &&
        tuple.object === "admin_surface:user_provisioning",
    }));

    const { POST } = await import("../route");
    const response = await POST(
      request({ email: "Alice@Corp.COM", source: "slack-bot:jit", attributes: { slack_user_id: ["U123"] } })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { sub: "new-kc-uuid", created: true } });
    expect(mockProvisionShellUser).toHaveBeenCalledWith({
      email: "alice@corp.com",
      source: "slack-bot:jit",
      attributes: { slack_user_id: ["U123"] },
    });
  });

  it("allows an org admin via the can_manage bypass", async () => {
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { relation: string; object: string }) => ({
      allowed: tuple.relation === "can_manage" && tuple.object === "organization:caipe",
    }));

    const { POST } = await import("../route");
    const response = await POST(request({ email: "bob@corp.com", source: "admin-ui" }));

    expect(response.status).toBe(200);
    expect(mockProvisionShellUser).toHaveBeenCalledWith({
      email: "bob@corp.com",
      source: "admin-ui",
      attributes: undefined,
    });
  });

  it("denies a caller without the provisioning grant", async () => {
    const { POST } = await import("../route");
    const response = await POST(request({ email: "alice@corp.com", source: "slack-bot:jit" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("admin_surface#write");
    expect(mockProvisionShellUser).not.toHaveBeenCalled();
  });

  describe("request validation (after auth)", () => {
    beforeEach(() => {
      mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
        allowed:
          tuple.user === "service_account:slack-bot-sub" &&
          tuple.relation === "can_write" &&
          tuple.object === "admin_surface:user_provisioning",
      }));
    });

    it("rejects a missing email", async () => {
      const { POST } = await import("../route");
      const response = await POST(request({ source: "slack-bot:jit" }));
      expect(response.status).toBe(400);
      expect(mockProvisionShellUser).not.toHaveBeenCalled();
    });

    it("rejects an invalid email", async () => {
      const { POST } = await import("../route");
      const response = await POST(request({ email: "not-an-email", source: "slack-bot:jit" }));
      expect(response.status).toBe(400);
      expect(mockProvisionShellUser).not.toHaveBeenCalled();
    });

    it("rejects a missing source", async () => {
      const { POST } = await import("../route");
      const response = await POST(request({ email: "alice@corp.com" }));
      expect(response.status).toBe(400);
      expect(mockProvisionShellUser).not.toHaveBeenCalled();
    });

    it("rejects a non-object body", async () => {
      const { POST } = await import("../route");
      const response = await POST(request("not json"));
      expect(response.status).toBe(400);
      expect(mockProvisionShellUser).not.toHaveBeenCalled();
    });

    it("strips caller-supplied created_by / created_at (server-owned)", async () => {
      const { POST } = await import("../route");
      const response = await POST(
        request({
          email: "alice@corp.com",
          source: "slack-bot:jit",
          attributes: {
            slack_user_id: ["U1"],
            created_by: ["attacker"],
            created_at: ["1999-01-01T00:00:00Z"],
          },
        })
      );

      expect(response.status).toBe(200);
      expect(mockProvisionShellUser).toHaveBeenCalledWith({
        email: "alice@corp.com",
        source: "slack-bot:jit",
        attributes: { slack_user_id: ["U1"] },
      });
    });

    it("rejects non-string-array attribute values", async () => {
      const { POST } = await import("../route");
      const response = await POST(
        request({ email: "alice@corp.com", source: "slack-bot:jit", attributes: { slack_user_id: "U1" } })
      );
      expect(response.status).toBe(400);
      expect(mockProvisionShellUser).not.toHaveBeenCalled();
    });
  });
});
