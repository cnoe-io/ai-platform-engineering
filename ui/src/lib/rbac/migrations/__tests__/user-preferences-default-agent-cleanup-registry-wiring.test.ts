/** @jest-environment node */

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  connectToDatabase: jest.fn(),
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));
jest.mock("@/lib/rbac/openfga", () => ({
  deleteExactOpenFgaTuples: jest.fn(),
  readOpenFgaTuples: jest.fn(),
  writeOpenFgaTuples: jest.fn(),
}));

import { applyMigration, planMigration } from "../registry";
import {
  USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_CONFIRMATION,
  USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
} from "../user-preferences-default-agent-cleanup";

describe("user-preferences cleanup registry wiring", () => {
  const userPreferences = {
    countDocuments: jest.fn(),
    updateMany: jest.fn(),
  };
  const schemaMigrations = { updateOne: jest.fn() };
  const schemaVersions = { updateOne: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    userPreferences.countDocuments.mockResolvedValue(3);
    userPreferences.updateMany.mockResolvedValue({ modifiedCount: 3 });
    schemaMigrations.updateOne.mockResolvedValue({});
    schemaVersions.updateOne.mockResolvedValue({});
    mockGetCollection.mockImplementation((name: string) => {
      if (name === "user_preferences") return userPreferences;
      if (name === "schema_migrations") return schemaMigrations;
      if (name === "data_schema_versions") return schemaVersions;
      throw new Error(`Unexpected collection: ${name}`);
    });
  });

  it("plans from the live legacy-field count", async () => {
    const plan = await planMigration(
      USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
    );

    expect(plan.counts.preferences_with_legacy_dm_default).toBe(3);
    expect(userPreferences.countDocuments).toHaveBeenCalledWith({
      dm_default_agent_id: { $exists: true },
    });
  });

  it("applies the unset and records the completed schema version", async () => {
    const now = "2026-07-16T20:00:00.000Z";

    await applyMigration({
      migrationId: USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
      actor: "admin@example.com",
      confirmation: USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_CONFIRMATION,
      now,
    });

    expect(userPreferences.updateMany).toHaveBeenCalledWith(
      { dm_default_agent_id: { $exists: true } },
      { $unset: { dm_default_agent_id: "" } },
    );
    expect(schemaMigrations.updateOne).toHaveBeenCalledWith(
      { _id: USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID },
      expect.objectContaining({
        $set: expect.objectContaining({
          release: "0.6.0",
          schema_area: "user_preferences",
          status: "completed",
          applied_counts: {
            preferences_cleaned: 3,
            tuple_writes_applied: 0,
          },
        }),
      }),
      { upsert: true },
    );
    expect(schemaVersions.updateOne).toHaveBeenCalledWith(
      { _id: "user_preferences" },
      expect.objectContaining({
        $set: expect.objectContaining({
          version: 2,
          last_migration_id:
            USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
        }),
      }),
      { upsert: true },
    );
  });
});
