import {
  applyUserPreferencesDefaultAgentCleanupMigration,
  deriveUserPreferencesDefaultAgentCleanupPlan,
  LEGACY_DM_DEFAULT_AGENT_FILTER,
  USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_CONFIRMATION,
  USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
} from "../user-preferences-default-agent-cleanup";

const now = "2026-07-16T20:00:00.000Z";

describe("deriveUserPreferencesDefaultAgentCleanupPlan", () => {
  it("describes the destructive legacy-field cleanup without a backfill", () => {
    const plan = deriveUserPreferencesDefaultAgentCleanupPlan(7);

    expect(plan).toMatchObject({
      migration_id: USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
      release: "0.6.0",
      schema_area: "user_preferences",
      from_version: 1,
      to_version: 2,
      counts: {
        preferences_with_legacy_dm_default: 7,
        tuple_writes_planned: 0,
      },
      confirmation: USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_CONFIRMATION,
    });
    expect(plan.warnings.join(" ")).toMatch(/without being copied/i);
    expect(plan.sample_diffs).toEqual([
      {
        collection: "user_preferences",
        id: "dm_default_agent_id",
        before: { dm_default_agent_id: "<present>" },
        after: { dm_default_agent_id: "<unset>" },
      },
    ]);
  });

  it("is a clean no-op plan when no legacy fields remain", () => {
    const plan = deriveUserPreferencesDefaultAgentCleanupPlan(0);

    expect(plan.counts.preferences_with_legacy_dm_default).toBe(0);
    expect(plan.warnings).toEqual([]);
    expect(plan.sample_diffs).toEqual([]);
  });
});

describe("applyUserPreferencesDefaultAgentCleanupMigration", () => {
  it("unsets only dm_default_agent_id and preserves the preference timestamp", async () => {
    const countDocuments = jest.fn().mockResolvedValue(4);
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 4 });

    const result = await applyUserPreferencesDefaultAgentCleanupMigration({
      actor: "admin@example.com",
      now,
      collection: { countDocuments, updateMany },
    });

    expect(countDocuments).toHaveBeenCalledWith(LEGACY_DM_DEFAULT_AGENT_FILTER);
    expect(updateMany).toHaveBeenCalledWith(LEGACY_DM_DEFAULT_AGENT_FILTER, {
      $unset: { dm_default_agent_id: "" },
    });
    expect(result.applied_counts).toEqual({
      preferences_cleaned: 4,
      tuple_writes_applied: 0,
    });
    expect(result.applied_at).toBe(now);
    expect(result.applied_by).toBe("admin@example.com");
  });

  it("is idempotent after the legacy field has already been removed", async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });

    const result = await applyUserPreferencesDefaultAgentCleanupMigration({
      actor: "admin@example.com",
      now,
      collection: {
        countDocuments: jest.fn().mockResolvedValue(0),
        updateMany,
      },
    });

    expect(updateMany).toHaveBeenCalledWith(LEGACY_DM_DEFAULT_AGENT_FILTER, {
      $unset: { dm_default_agent_id: "" },
    });
    expect(result.applied_counts.preferences_cleaned).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});
