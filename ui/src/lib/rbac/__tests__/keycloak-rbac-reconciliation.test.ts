/**
 * @jest-environment node
 */

// Phase 3 (spec 2026-05-24-derive-team-from-channel) demolished the
// team-scope branch of the Keycloak RBAC reconciliation. This test
// pins what survived: OBO permission wiring, the platform audience
// token-exchange decision strategy, bot service-account
// impersonation roles, and the bootstrap admin tuple-seeding hook.
// The deleted helpers (`ensureTeamClientScope`,
// `ensurePersonalTeamClientScope`, `deleteOrphanTeamClientScopes`,
// `selectAgentGatewayActiveTeamScope`) are no longer mocked because
// `keycloak-rbac-reconciliation.ts` no longer imports them.

const mockGetCollection = jest.fn();
const mockEnsureSlackBotOboPermissions = jest.fn();
const mockEnsureWebexBotOboPermissions = jest.fn();
const mockEnsureBotServiceAccountImpersonationRoles = jest.fn();
const mockEnsureCaipePlatformTokenExchangeDecisionStrategy = jest.fn();
const mockEnsureSchedulerRunnerClient = jest.fn();
const mockEnsureSchedulerRunnerOboPermissions = jest.fn();
const mockReconcileBootstrapAdmins = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  ensureSlackBotOboPermissions: (...args: unknown[]) => mockEnsureSlackBotOboPermissions(...args),
  ensureWebexBotOboPermissions: (...args: unknown[]) => mockEnsureWebexBotOboPermissions(...args),
  ensureSchedulerRunnerClient: (...args: unknown[]) =>
    mockEnsureSchedulerRunnerClient(...args),
  ensureSchedulerRunnerOboPermissions: (...args: unknown[]) =>
    mockEnsureSchedulerRunnerOboPermissions(...args),
  ensureBotServiceAccountImpersonationRoles: (...args: unknown[]) =>
    mockEnsureBotServiceAccountImpersonationRoles(...args),
  ensureCaipePlatformTokenExchangeDecisionStrategy: (...args: unknown[]) =>
    mockEnsureCaipePlatformTokenExchangeDecisionStrategy(...args),
  isValidTeamSlug: (slug: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug),
}));

jest.mock("@/lib/rbac/keycloak-bootstrap-admins", () => ({
  reconcileBootstrapAdmins: (...args: unknown[]) => mockReconcileBootstrapAdmins(...args),
}));

function createCollection(rows: Array<Record<string, unknown>> = []) {
  return {
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(rows),
    }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "lock-acquired" }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, upsertedCount: 0 }),
  };
}

describe("keycloak RBAC startup reconciliation migration (post Phase 3 demolition)", () => {
  const originalEnv = { ...process.env };
  let collections: Record<string, ReturnType<typeof createCollection>>;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: "http://keycloak",
    };
    collections = {
      teams: createCollection([
        { _id: "team-1", slug: "platform", name: "Platform" },
        { _id: "team-2", slug: "eti-sre-admins", name: "ETI SRE Admins" },
      ]),
      migration_manifest: createCollection(),
      schema_migrations: createCollection(),
      data_schema_versions: createCollection(),
    };
    mockGetCollection.mockImplementation(async (name: string) => collections[name]);
    mockEnsureSlackBotOboPermissions.mockResolvedValue(undefined);
    mockEnsureWebexBotOboPermissions.mockResolvedValue(undefined);
    mockEnsureBotServiceAccountImpersonationRoles.mockResolvedValue(undefined);
    mockEnsureCaipePlatformTokenExchangeDecisionStrategy.mockResolvedValue(undefined);
    mockReconcileBootstrapAdmins.mockResolvedValue({
      enabled: true,
      configured_emails: ["admin@cisco.com"],
      resolved_count: 1,
      created_count: 0,
      failed_count: 0,
      tuple_write_count: 3,
      warnings: [],
      outcomes: [
        {
          email: "admin@cisco.com",
          user_id: "sub-admin",
          status: "existing",
          tuple_write_count: 3,
        },
      ],
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("applies OBO + bootstrap-admin reconciliation (no team-scope helpers) and records a completed migration", async () => {
    const { runKeycloakRbacStartupMigration, KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID } =
      await import("../keycloak-rbac-reconciliation");

    const result = await runKeycloakRbacStartupMigration({ actor: "startup-test" });

    expect(result.status).toBe("completed");
    // OBO permission wiring + token-exchange decision strategy are
    // the team-agnostic remnants that survived Phase 3.
    expect(mockEnsureSlackBotOboPermissions).toHaveBeenCalled();
    expect(mockEnsureWebexBotOboPermissions).toHaveBeenCalled();
    expect(mockEnsureSchedulerRunnerClient).toHaveBeenCalled();
    expect(mockEnsureSchedulerRunnerOboPermissions).toHaveBeenCalled();
    // Bots are wired in one call; the scheduler-runner is wired separately so a
    // not-yet-provisioned client can't fail the whole reconciliation.
    expect(mockEnsureBotServiceAccountImpersonationRoles).toHaveBeenCalledWith([
      "caipe-slack-bot",
      "caipe-webex-bot",
    ]);
    expect(mockEnsureBotServiceAccountImpersonationRoles).toHaveBeenCalledWith([
      "caipe-scheduler-runner",
    ]);
    expect(mockEnsureCaipePlatformTokenExchangeDecisionStrategy).toHaveBeenCalledWith("AFFIRMATIVE");
    expect(mockReconcileBootstrapAdmins).toHaveBeenCalledWith({ actor: "startup-test" });

    expect(collections.migration_manifest.updateOne).toHaveBeenCalledWith(
      { _id: KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID },
      expect.objectContaining({
        $set: expect.objectContaining({
          migration_id: KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID,
          schema_area: "keycloak_rbac_mappings",
          managed_by: "runtime",
        }),
      }),
      { upsert: true }
    );
    expect(collections.schema_migrations.updateOne).toHaveBeenCalledWith(
      { _id: KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "completed",
          applied_counts: expect.objectContaining({
            obo_permission_sets_reconciled: 3,
            bootstrap_admins_resolved: 1,
            bootstrap_admin_tuples_written: 3,
          }),
          updated_by: "startup-test",
        }),
      }),
      { upsert: true }
    );
    expect(collections.data_schema_versions.updateOne).toHaveBeenCalledWith(
      { _id: "keycloak_rbac_mappings" },
      expect.objectContaining({
        $set: expect.objectContaining({
          version: 1,
          last_migration_id: KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID,
        }),
      }),
      { upsert: true }
    );
  });

  it("records a failed migration without throwing when Keycloak reconciliation fails", async () => {
    mockEnsureWebexBotOboPermissions.mockRejectedValue(new Error("Keycloak unavailable"));
    const { runKeycloakRbacStartupMigration, KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID } =
      await import("../keycloak-rbac-reconciliation");

    const result = await runKeycloakRbacStartupMigration({ actor: "startup-test" });

    expect(result.status).toBe("failed");
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Keycloak unavailable")]));
    expect(collections.schema_migrations.updateOne).toHaveBeenLastCalledWith(
      { _id: KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "failed",
          error: "Keycloak unavailable",
          updated_by: "startup-test",
        }),
      }),
      { upsert: true }
    );
    expect(collections.data_schema_versions.updateOne).not.toHaveBeenCalled();
  });

  it("records a failed migration when bootstrap admin tuple seeding fails", async () => {
    mockReconcileBootstrapAdmins.mockResolvedValue({
      enabled: true,
      actor: "startup-test",
      configured_emails: ["admin@cisco.com"],
      resolved_count: 0,
      created_count: 0,
      failed_count: 1,
      tuple_write_count: 0,
      warnings: ["admin@cisco.com: OpenFGA is not configured"],
      outcomes: [
        {
          email: "admin@cisco.com",
          user_id: "sub-admin",
          status: "failed",
          tuple_write_count: 0,
          error: "OpenFGA is not configured",
        },
      ],
    });
    const { runKeycloakRbacStartupMigration, KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID } =
      await import("../keycloak-rbac-reconciliation");

    const result = await runKeycloakRbacStartupMigration({ actor: "startup-test" });

    expect(result.status).toBe("failed");
    expect(result.warnings).toEqual(expect.arrayContaining(["admin@cisco.com: OpenFGA is not configured"]));
    expect(collections.schema_migrations.updateOne).toHaveBeenLastCalledWith(
      { _id: KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "failed",
          bootstrap_admins: expect.objectContaining({
            failed_count: 1,
            outcomes: expect.arrayContaining([
              expect.objectContaining({ email: "admin@cisco.com", status: "failed" }),
            ]),
          }),
        }),
      }),
      { upsert: true }
    );
    expect(collections.data_schema_versions.updateOne).not.toHaveBeenCalled();
  });
});
