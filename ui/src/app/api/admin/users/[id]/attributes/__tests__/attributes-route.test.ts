/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/users/[id]/attributes — the first-party
 * attribute-merge endpoint the Slack bot calls (spec
 * 2026-06-09-slack-bot-remove-direct-keycloak-admin).
 *
 * Covers:
 *  - the bot service account (graphed `service_account:<sub>`) is authorized
 *    via `writer admin_surface:user_directory` and the merge runs;
 *  - an org admin passes via the can_manage bypass;
 *  - a caller with no grant is denied 403;
 *  - the writable-key whitelist (400 on a disallowed key, incl. created_by);
 *  - body validation (non-object body, empty attributes, non-string-array).
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { ApiError } from "@/lib/api-error";
import { NextRequest } from "next/server";

const mockRequireResourcePermission = jest.fn();
const mockMergeUserAttributes = jest.fn();

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

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) =>
    mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  mergeUserAttributes: (...args: unknown[]) => mockMergeUserAttributes(...args),
}));

function request(id: string, body: unknown) {
  const req = new NextRequest(
    new URL(`/api/admin/users/${id}/attributes`, "http://localhost:3000"),
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        "X-Client-Source": "slack-bot",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }
  );
  return { req, context: { params: Promise.resolve({ id }) } };
}

// Grant `writer admin_surface:user_directory` to the bot SA.
function grantDirectoryWriter() {
  mockRequireResourcePermission.mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireResourcePermission.mockRejectedValue(
    new ApiError(
      "You do not have permission to access this resource.",
      403,
      "admin_surface#write",
      "pdp_denied",
      "contact_admin"
    )
  );
  mockMergeUserAttributes.mockResolvedValue(undefined);
});

describe("PATCH /api/admin/users/[id]/attributes", () => {
  it("merges attributes for the bot SA with writer admin_surface:user_directory", async () => {
    grantDirectoryWriter();

    const { PATCH } = await import("../route");
    const { req, context } = request("kc-uuid-1", {
      attributes: { slack_user_id: ["U123"] },
    });
    const response = await PATCH(req, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { ok: true } });
    expect(mockMergeUserAttributes).toHaveBeenCalledWith("kc-uuid-1", {
      slack_user_id: ["U123"],
    });
  });

  it("allows an org admin via the can_manage bypass", async () => {
    mockRequireResourcePermission.mockResolvedValue(undefined);

    const { PATCH } = await import("../route");
    const { req, context } = request("kc-uuid-2", {
      attributes: { slack_preauth_prompted_at: ["1700000000"] },
    });
    const response = await PATCH(req, context);

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "slack-bot-sub" }),
      { type: "admin_surface", id: "user_directory", action: "write" },
      { bypassForOrgAdmin: true }
    );
    expect(mockMergeUserAttributes).toHaveBeenCalledWith("kc-uuid-2", {
      slack_preauth_prompted_at: ["1700000000"],
    });
  });

  it("denies a caller without the directory-write grant", async () => {
    const { PATCH } = await import("../route");
    const { req, context } = request("kc-uuid-3", {
      attributes: { slack_user_id: ["U1"] },
    });
    const response = await PATCH(req, context);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("admin_surface#write");
    expect(mockMergeUserAttributes).not.toHaveBeenCalled();
  });

  describe("body validation (after auth)", () => {
    beforeEach(() => {
      grantDirectoryWriter();
    });

    it("rejects a non-whitelisted attribute key", async () => {
      const { PATCH } = await import("../route");
      const { req, context } = request("kc-uuid-4", {
        attributes: { caipe_default_team_id: ["platform"] },
      });
      const response = await PATCH(req, context);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe("ATTRIBUTE_NOT_ALLOWED");
      expect(mockMergeUserAttributes).not.toHaveBeenCalled();
    });

    it("rejects the server-owned created_by key", async () => {
      const { PATCH } = await import("../route");
      const { req, context } = request("kc-uuid-5", {
        attributes: { slack_user_id: ["U1"], created_by: ["attacker"] },
      });
      const response = await PATCH(req, context);
      expect(response.status).toBe(400);
      expect(mockMergeUserAttributes).not.toHaveBeenCalled();
    });

    it("rejects a missing attributes object", async () => {
      const { PATCH } = await import("../route");
      const { req, context } = request("kc-uuid-6", {});
      const response = await PATCH(req, context);
      expect(response.status).toBe(400);
      expect(mockMergeUserAttributes).not.toHaveBeenCalled();
    });

    it("rejects empty attributes", async () => {
      const { PATCH } = await import("../route");
      const { req, context } = request("kc-uuid-7", { attributes: {} });
      const response = await PATCH(req, context);
      expect(response.status).toBe(400);
      expect(mockMergeUserAttributes).not.toHaveBeenCalled();
    });

    it("rejects a non-string-array attribute value", async () => {
      const { PATCH } = await import("../route");
      const { req, context } = request("kc-uuid-8", {
        attributes: { slack_user_id: "U1" },
      });
      const response = await PATCH(req, context);
      expect(response.status).toBe(400);
      expect(mockMergeUserAttributes).not.toHaveBeenCalled();
    });

    it("rejects a non-object body", async () => {
      const { PATCH } = await import("../route");
      const { req, context } = request("kc-uuid-9", "not json");
      const response = await PATCH(req, context);
      expect(response.status).toBe(400);
      expect(mockMergeUserAttributes).not.toHaveBeenCalled();
    });
  });
});
