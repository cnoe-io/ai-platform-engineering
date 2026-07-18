import type { MigrationApplyResult, MigrationPlanResult } from "./types";

/**
 * Remove the shared DM default that predates per-surface Slack and Webex
 * preferences. The value is intentionally not copied: after this migration,
 * an unset surface follows the resolved platform default until the user makes
 * a new explicit choice.
 */
export const USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID =
  "user_preferences_default_agent_cleanup_v1";
export const USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_CONFIRMATION =
  "REMOVE legacy user_preferences.dm_default_agent_id";

export const LEGACY_DM_DEFAULT_AGENT_FILTER: Record<string, unknown> = {
  dm_default_agent_id: { $exists: true },
};

interface UserPreferencesDefaultAgentCleanupCollection {
  countDocuments: (filter: Record<string, unknown>) => Promise<number>;
  updateMany: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => Promise<{ modifiedCount?: number }>;
}

interface ApplyUserPreferencesDefaultAgentCleanupInput {
  actor: string;
  now: string;
  collection: UserPreferencesDefaultAgentCleanupCollection;
}

export function deriveUserPreferencesDefaultAgentCleanupPlan(
  preferencesWithLegacyDmDefault: number,
): MigrationPlanResult {
  return {
    migration_id: USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
    release: "0.6.0",
    schema_area: "user_preferences",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      preferences_with_legacy_dm_default: preferencesWithLegacyDmDefault,
      tuple_writes_planned: 0,
    },
    warnings:
      preferencesWithLegacyDmDefault > 0
        ? [
            "Legacy DM defaults will be removed without being copied to Slack or Webex. Those surfaces will use the platform default until users choose a new per-surface default.",
          ]
        : [],
    sample_diffs:
      preferencesWithLegacyDmDefault > 0
        ? [
            {
              collection: "user_preferences",
              id: "dm_default_agent_id",
              before: { dm_default_agent_id: "<present>" },
              after: { dm_default_agent_id: "<unset>" },
            },
          ]
        : [],
    tuple_writes_planned: 0,
    confirmation: USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_CONFIRMATION,
  };
}

export async function applyUserPreferencesDefaultAgentCleanupMigration(
  input: ApplyUserPreferencesDefaultAgentCleanupInput,
): Promise<MigrationApplyResult> {
  const preferencesWithLegacyDmDefault = await input.collection.countDocuments(
    LEGACY_DM_DEFAULT_AGENT_FILTER,
  );
  const plan = deriveUserPreferencesDefaultAgentCleanupPlan(
    preferencesWithLegacyDmDefault,
  );

  const result = await input.collection.updateMany(LEGACY_DM_DEFAULT_AGENT_FILTER, {
    $unset: { dm_default_agent_id: "" },
  });

  return {
    ...plan,
    applied_counts: {
      preferences_cleaned: result.modifiedCount ?? 0,
      tuple_writes_applied: 0,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };
}
