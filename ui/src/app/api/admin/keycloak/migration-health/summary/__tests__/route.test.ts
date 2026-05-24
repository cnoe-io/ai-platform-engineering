/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockRequireMigrationAdmin = jest.fn();
const mockGetKeycloakMigrationHealth = jest.fn();

jest.mock("../../../../rebac/migrations/_lib", () => ({
  requireMigrationAdmin: (...args: unknown[]) => mockRequireMigrationAdmin(...args),
}));

jest.mock("@/lib/rbac/keycloak-migration-health", () => ({
  getKeycloakMigrationHealth: (...args: unknown[]) =>
    mockGetKeycloakMigrationHealth(...args),
}));

function request(): NextRequest {
  return new NextRequest(new URL("/api/admin/keycloak/migration-health/summary", "http://localhost:3000"), {
    headers: { Authorization: "Bearer test-token" },
  });
}

function buildHealth(overrides: {
  reachable?: boolean;
  configured?: boolean;
  failing?: number;
  unknown?: number;
  passing?: number;
  invariantsOmitted?: boolean;
} = {}) {
  const {
    reachable = true,
    configured = true,
    failing = 0,
    unknown = 0,
    passing = 10,
    invariantsOmitted = false,
  } = overrides;
  return {
    keycloak: {
      configured,
      reachable,
      realm: "caipe",
      last_probe_at: "2026-05-24T13:00:00.000Z",
    },
    schema_area: {
      area: "keycloak_rbac_mappings",
      current_version: 1,
      target_version: 1,
      status: "current",
    },
    migration: { id: "keycloak_rbac_mapping_reconciliation_v1", manifest_status: "completed" },
    blocking: { is_blocking: false, blocking_required_count: 0 },
    keycloak_invariants: invariantsOmitted
      ? undefined
      : {
          summary: {
            total: passing + failing + unknown,
            passing,
            failing,
            unknown,
            reconcile_now_recommended: failing > 0,
          },
          items: [],
        },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockRequireMigrationAdmin.mockResolvedValue({
    user: { email: "admin@example.com" },
    session: {},
  });
});

describe("GET /api/admin/keycloak/migration-health/summary", () => {
  it("flags has_issues when invariants are failing and surfaces summary counts", async () => {
    mockGetKeycloakMigrationHealth.mockResolvedValueOnce(
      buildHealth({ failing: 3, unknown: 1, passing: 8 }),
    );
    const { GET, __resetKeycloakHealthSummaryCacheForTests } = await import("../route");
    __resetKeycloakHealthSummaryCacheForTests();

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      configured: true,
      reachable: true,
      realm: "caipe",
      has_issues: true,
      cached: false,
      invariants: {
        total: 12,
        passing: 8,
        failing: 3,
        unknown: 1,
        reconcile_now_recommended: true,
      },
    });
  });

  it("flags has_issues when Keycloak is configured but unreachable, even with no failing invariants", async () => {
    mockGetKeycloakMigrationHealth.mockResolvedValueOnce(
      buildHealth({ reachable: false, invariantsOmitted: true }),
    );
    const { GET, __resetKeycloakHealthSummaryCacheForTests } = await import("../route");
    __resetKeycloakHealthSummaryCacheForTests();

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.has_issues).toBe(true);
    expect(body.data.invariants).toBeNull();
  });

  it("returns has_issues=false when Keycloak is healthy and invariants pass", async () => {
    mockGetKeycloakMigrationHealth.mockResolvedValueOnce(buildHealth({ passing: 12 }));
    const { GET, __resetKeycloakHealthSummaryCacheForTests } = await import("../route");
    __resetKeycloakHealthSummaryCacheForTests();

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.has_issues).toBe(false);
    expect(body.data.invariants.failing).toBe(0);
  });

  it("serves repeat calls from the 60s cache without round-tripping Keycloak", async () => {
    mockGetKeycloakMigrationHealth.mockResolvedValueOnce(buildHealth({ failing: 1 }));
    const { GET, __resetKeycloakHealthSummaryCacheForTests } = await import("../route");
    __resetKeycloakHealthSummaryCacheForTests();

    const first = await GET(request());
    const second = await GET(request());
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(mockGetKeycloakMigrationHealth).toHaveBeenCalledTimes(1);
    expect(firstBody.data.cached).toBe(false);
    expect(secondBody.data.cached).toBe(true);
    // Same payload, just the cached flag flips.
    expect(secondBody.data.invariants.failing).toBe(1);
  });

  it("propagates the admin guard rejection without calling Keycloak", async () => {
    mockRequireMigrationAdmin.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { statusCode: 403 }),
    );
    const { GET, __resetKeycloakHealthSummaryCacheForTests } = await import("../route");
    __resetKeycloakHealthSummaryCacheForTests();

    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mockGetKeycloakMigrationHealth).not.toHaveBeenCalled();
  });
});
