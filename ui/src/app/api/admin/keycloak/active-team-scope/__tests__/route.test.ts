/**
 * @jest-environment node
 *
 * Tests for `POST /api/admin/keycloak/active-team-scope` — the targeted
 * heal route for the `audience.<client>.single_team_default` invariant.
 * The route is a thin wrapper around `selectAgentGatewayActiveTeamScope`
 * with admin-only auth and structured one-line audit logging.
 *
 * assisted-by Claude Claude-opus-4-7
 */

import { NextRequest } from "next/server";

const mockSelectActiveTeamScope = jest.fn();
const mockRequireMigrationAdmin = jest.fn();
const mockGetAuth = jest.fn();
const mockRequireRbac = jest.fn();
const mockIsBootstrapAdmin = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  withErrorHandler:
    <T,>(handler: (request: NextRequest) => Promise<T>) =>
    async (request: NextRequest) => {
      try {
        return await handler(request);
      } catch (err) {
        const error = err as Error & { statusCode?: number; code?: string };
        const status = error.statusCode ?? 500;
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
            code: error.code,
          }),
          {
            status,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    },
  successResponse: (data: unknown) =>
    new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbac(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  isBootstrapAdmin: (...args: unknown[]) => mockIsBootstrapAdmin(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  selectAgentGatewayActiveTeamScope: (...args: unknown[]) => mockSelectActiveTeamScope(...args),
  BOT_OBO_AUDIENCE_CLIENT_ID: "caipe-platform",
}));

// `_lib.ts` does its own composition of getAuthFromBearerOrSession +
// requireRbacPermission; mock the whole module so the route's import of
// `requireMigrationAdmin` is testable as a single seam.
jest.mock("@/app/api/admin/rebac/migrations/_lib", () => ({
  requireMigrationAdmin: (request: NextRequest) => mockRequireMigrationAdmin(request),
}));

function postJson(body: unknown): NextRequest {
  return new NextRequest(
    new URL("/api/admin/keycloak/active-team-scope", "http://localhost:3000"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/admin/keycloak/active-team-scope", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireMigrationAdmin.mockResolvedValue({
      user: { email: "admin@example.com" },
      session: { sub: "admin-sub", role: "admin" },
    });
    mockSelectActiveTeamScope.mockResolvedValue(undefined);
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("calls selectAgentGatewayActiveTeamScope with the lowercased slug and returns success", async () => {
    const { POST } = await import("../route");

    const response = await POST(postJson({ team_slug: "Platform" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        active_team_slug: "platform",
        audience_client_id: "caipe-platform",
      },
    });
    expect(mockSelectActiveTeamScope).toHaveBeenCalledTimes(1);
    expect(mockSelectActiveTeamScope).toHaveBeenCalledWith("platform");
  });

  it("trims whitespace from the slug", async () => {
    const { POST } = await import("../route");

    const response = await POST(postJson({ team_slug: "  platform  " }));

    expect(response.status).toBe(200);
    expect(mockSelectActiveTeamScope).toHaveBeenCalledWith("platform");
  });

  it("requires admin auth before doing anything (auth failure short-circuits)", async () => {
    const authError = new Error("Forbidden") as Error & { statusCode?: number };
    authError.statusCode = 403;
    mockRequireMigrationAdmin.mockRejectedValueOnce(authError);
    const { POST } = await import("../route");

    const response = await POST(postJson({ team_slug: "platform" }));

    expect(response.status).toBe(403);
    expect(mockSelectActiveTeamScope).not.toHaveBeenCalled();
  });

  it("returns 400 when team_slug is missing", async () => {
    const { POST } = await import("../route");

    const response = await POST(postJson({}));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("ACTIVE_TEAM_SCOPE_TEAM_SLUG_REQUIRED");
    expect(mockSelectActiveTeamScope).not.toHaveBeenCalled();
  });

  it("returns 400 when team_slug is empty after trim", async () => {
    const { POST } = await import("../route");

    const response = await POST(postJson({ team_slug: "   " }));

    expect(response.status).toBe(400);
    expect(mockSelectActiveTeamScope).not.toHaveBeenCalled();
  });

  it("returns 400 when team_slug is not a string", async () => {
    const { POST } = await import("../route");

    const response = await POST(postJson({ team_slug: 42 }));

    expect(response.status).toBe(400);
    expect(mockSelectActiveTeamScope).not.toHaveBeenCalled();
  });

  it("emits a structured audit log line with actor, slug, and audience client", async () => {
    const { POST } = await import("../route");

    await POST(postJson({ team_slug: "platform" }));

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(logged).toEqual({
      event: "admin.keycloak.active_team_scope.reconcile",
      actor: "admin@example.com",
      team_slug: "platform",
      audience_client_id: "caipe-platform",
    });
  });

  it("propagates Keycloak errors with a 5xx (e.g. invalid slug regex from kc-admin)", async () => {
    mockSelectActiveTeamScope.mockRejectedValueOnce(
      new Error('Invalid team slug "BAD!" — must be lowercase alphanumerics'),
    );
    const { POST } = await import("../route");

    const response = await POST(postJson({ team_slug: "BAD!" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/Invalid team slug/);
  });

  it("propagates a missing-realm-object error from kc-admin (audience client not found)", async () => {
    mockSelectActiveTeamScope.mockRejectedValueOnce(
      new Error('Keycloak audience client "caipe-platform" not found'),
    );
    const { POST } = await import("../route");

    const response = await POST(postJson({ team_slug: "platform" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/audience client.*not found/);
  });
});
