/**
 * @jest-environment node
 */

const mockGetCollection = jest.fn();
const mockListReleaseMigrations = jest.fn();
const mockGetMigrationBlockingStatus = jest.fn();
const mockGetKeycloakRbacDiagnosticValues = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/migrations/registry", () => ({
  listReleaseMigrations: (...args: unknown[]) => mockListReleaseMigrations(...args),
  getMigrationBlockingStatus: (...args: unknown[]) => mockGetMigrationBlockingStatus(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  getKeycloakRbacDiagnosticValues: (...args: unknown[]) =>
    mockGetKeycloakRbacDiagnosticValues(...args),
}));

describe("getKeycloakMigrationHealth status classification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: "http://keycloak",
      KEYCLOAK_REALM: "caipe",
    };
    mockListReleaseMigrations.mockResolvedValue({
      schema_versions: [
        {
          schema_area: "keycloak_rbac_mappings",
          current_version: 1,
          target_version: 1,
          status: "current",
        },
      ],
      migrations: [{ id: "keycloak_rbac_mapping_reconciliation_v1", status: "completed" }],
      completed_migrations: [],
    });
    mockGetMigrationBlockingStatus.mockResolvedValue({
      is_blocking: false,
      blocking_required_count: 0,
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function schemaMigrationsWith(error: string) {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "keycloak_rbac_mapping_reconciliation_v1",
        status: "failed",
        error,
        warnings: [error],
        applied_counts: {},
        planned_counts: {},
        updated_by: "startup",
      }),
    });
  }

  it("treats Keycloak Admin API 403 errors as authorization failures, not reachability failures", async () => {
    const message = "Keycloak Admin enableUsersManagementPermissions failed: 403 HTTP 403 Forbidden";
    schemaMigrationsWith(message);
    mockGetKeycloakRbacDiagnosticValues.mockRejectedValueOnce(new Error(message));

    const { getKeycloakMigrationHealth } = await import("../keycloak-migration-health");

    const health = await getKeycloakMigrationHealth({ actor: "admin@example.com" });

    expect(health.keycloak).toMatchObject({
      configured: true,
      reachable: true,
      status: "admin_authorization_error",
      probe_error: message,
    });
  });

  it("keeps network failures classified as unreachable", async () => {
    const message = "fetch failed";
    schemaMigrationsWith(message);
    mockGetKeycloakRbacDiagnosticValues.mockRejectedValueOnce(new TypeError(message));

    const { getKeycloakMigrationHealth } = await import("../keycloak-migration-health");

    const health = await getKeycloakMigrationHealth({ actor: "admin@example.com" });

    expect(health.keycloak).toMatchObject({
      configured: true,
      reachable: false,
      status: "unreachable",
      probe_error: message,
    });
  });
});
