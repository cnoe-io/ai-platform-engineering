/**
 * @jest-environment node
 */

const mockGetCollection = jest.fn();
const mockEnsureTeamClientScope = jest.fn();
const mockEnsurePersonalTeamClientScope = jest.fn();
const mockDeleteOrphanTeamClientScopes = jest.fn();
const mockEnsureSlackBotOboPermissions = jest.fn();
const mockEnsureWebexBotOboPermissions = jest.fn();
const mockEnsureBotServiceAccountImersonationRoles = jest.fn();
const mockEnsureCaipePlatformTokenExchangeDecisionStrategy = jest.fn();
const mockSelectAgentGatewayActiveTeamScope = jest.fn();
const mockReconcileBootstrapAdmins = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  ensureTeamClientScope: (...args: unknown[]) => mockEnsureTeamClientScope(...args),
  ensurePersonalTeamClientScope: (...args: unknown[]) => mockEnsurePersonalTeamClientScope(...args),
  deleteOrphanTeamClientScopes: (...args: unknown[]) => mockDeleteOrphanTeamClientScopes(...args),
  ensureSlackBotOboPermissions: (...args: unknown[]) => mockEnsureSlackBotOboPermissions(...args),
  ensureWebexBotOboPermissions: (...args: unknown[]) => mockEnsureWebexBotOboPermissions(...args),
  ensureBotServiceAccountImpersonationRoles: (...args: unknown[]) =>
    mockEnsureBotServiceAccountImersonationRoles(...args),
  ensureCaipePlatformTokenExchangeDecisionStrategy: (...args: unknown[]) =>
    mockEnsureCaipePlatformTokenExchangeDecisionStrategy(...args),
  selectAgentGatewayActiveTeamScope: (...args: unknown[]) => mockSelectAgentGatewayActiveTeamScope(...args),
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
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, upsertedCount: 0 }),
  };
}

describe("keycloak RBAC startup reconciliation migration", () => {
  const originalEnv = { ...process.env };
  let collections: Record<string, ReturnType<typeof createCollection>>;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: "http://keycloak",
      KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG: "platform",
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
    mockEnsureTeamClientScope.mockResolvedValue(undefined);
    mockEnsurePersonalTeamClientScope.mockResolvedValue(undefined);
    mockDeleteOrphanTeamClientScopes.mockResolvedValue([]);
    mockEnsureSlackBotOboPermissions.mockResolvedValue(undefined);
    mockEnsureWebexBotOboPermissions.mockResolvedValue(undefined);
    mockEnsureBotServiceAccountImersonationRoles.mockResolvedValue(undefined);
    mockEnsureCaipePlatformTokenExchangeDecisionStrategy.mockResolvedValue(undefined);
    mockSelectAgentGatewayActiveTeamScope.mockResolvedValue(undefined);
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

  it("applies Keycloak RBAC mappings and records a completed migration", async () => {
    const { runKeycloakRbacStartupMigration, KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID } =
      await import("../keycloak-rbac-reconciliation");

    const result = await runKeycloakRbacStartupMigration({ actor: "startup-test" });

    expect(result.status).toBe("completed");
    expect(mockEnsureTeamClientScope).toHaveBeenCalledWith("platform");
    expect(mockEnsureTeamClientScope).toHaveBeenCalledWith("eti-sre-admins");
    expect(mockEnsureSlackBotOboPermissions).toHaveBeenCalled();
    expect(mockEnsureWebexBotOboPermissions).toHaveBeenCalled();
    expect(mockEnsureBotServiceAccountImersonationRoles).toHaveBeenCalledWith([
      "caipe-slack-bot",
      "caipe-webex-bot",
    ]);
    expect(mockEnsureCaipePlatformTokenExchangeDecisionStrategy).toHaveBeenCalledWith("AFFIRMATIVE");
    expect(mockSelectAgentGatewayActiveTeamScope).toHaveBeenCalledWith("platform");
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
            team_scopes_reconciled: 2,
            obo_permission_sets_reconciled: 2,
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

  it("reconciles the team-personal scope and reports the count in applied_counts", async () => {
    const { runKeycloakRbacStartupMigration } =
      await import("../keycloak-rbac-reconciliation");

    const result = await runKeycloakRbacStartupMigration({ actor: "startup-test" });

    expect(result.status).toBe("completed");
    expect(mockEnsurePersonalTeamClientScope).toHaveBeenCalledTimes(1);
    expect(result.counts.personal_team_scope_reconciled).toBe(1);
  });

  it("deletes orphan team-* scopes and records both the count and a warning summary", async () => {
    mockDeleteOrphanTeamClientScopes.mockResolvedValue(["team-stale-one", "team-stale-two"]);
    const { runKeycloakRbacStartupMigration } =
      await import("../keycloak-rbac-reconciliation");

    const result = await runKeycloakRbacStartupMigration({ actor: "startup-test" });

    expect(result.status).toBe("completed");
    // The Mongo team slugs `platform` and `eti-sre-admins` are the allow-list;
    // `team-personal` is always preserved by deleteOrphanTeamClientScopes itself.
    expect(mockDeleteOrphanTeamClientScopes).toHaveBeenCalledWith([
      "eti-sre-admins",
      "platform",
    ]);
    expect(result.counts.orphan_team_scopes_deleted).toBe(2);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Removed 2 orphan team scope(s)"),
      ]),
    );
  });

  it("does not emit an orphan-removed warning when there is nothing to delete", async () => {
    mockDeleteOrphanTeamClientScopes.mockResolvedValue([]);
    const { runKeycloakRbacStartupMigration } =
      await import("../keycloak-rbac-reconciliation");

    const result = await runKeycloakRbacStartupMigration({ actor: "startup-test" });

    expect(result.status).toBe("completed");
    expect(result.counts.orphan_team_scopes_deleted).toBe(0);
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("orphan team scope(s)"),
      ]),
    );
  });
});
