jest.mock("@/lib/mongodb", () => ({
  connectToDatabase: jest.fn(),
  getCollection: jest.fn(),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: jest.fn(),
}));

import {
  getUnclassifiedSchemaAreas,
  SCHEMA_AREA_CLASSIFICATIONS,
} from "../schema-area-classifications";
import { MIGRATION_DEFINITIONS } from "../registry";
import { USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID } from "../user-preferences-default-agent-cleanup";

describe("migration registry guardrails", () => {
  it("classifies every registered migration schema area", () => {
    const missing = getUnclassifiedSchemaAreas(
      MIGRATION_DEFINITIONS.map((definition) => definition.schema_area),
    );

    expect(missing).toEqual([]);
  });

  it("keeps schema area classifications explicit for future collection additions", () => {
    expect(SCHEMA_AREA_CLASSIFICATIONS).toMatchObject({
      conversations: expect.objectContaining({ classification: "migration" }),
      messages: expect.objectContaining({ classification: "baseline_v1" }),
      data_schema_versions: expect.objectContaining({ classification: "metadata" }),
    });
    expect(getUnclassifiedSchemaAreas(["new_collection_without_registry_entry"])).toEqual([
      "new_collection_without_registry_entry",
    ]);
  });

  it("registers the user-preferences cleanup in the 0.6.0 manifest", () => {
    const definition = MIGRATION_DEFINITIONS.find(
      (migration) =>
        migration.id === USER_PREFERENCES_DEFAULT_AGENT_CLEANUP_MIGRATION_ID,
    );

    expect(definition).toMatchObject({
      release: "0.6.0",
      schema_area: "user_preferences",
      from_version: 1,
      to_version: 2,
      kind: "explicit",
      implemented: true,
    });
    expect(SCHEMA_AREA_CLASSIFICATIONS.user_preferences).toMatchObject({
      classification: "migration",
    });
  });
});
