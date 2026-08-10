import type { MigrationSchemaVersionStatus } from "@/lib/rbac/migrations/types";

/**
 * Schema areas that are missing version metadata but participate in the
 * migration manifest (have a target version). Orphan Mongo collections with
 * no planned migrations are excluded — they are not actionable from the
 * Migrations tab and should not inflate admin header alerts.
 */
export function schemaAreasNeedingVersionBootstrap(
  schemaVersions: Pick<
    MigrationSchemaVersionStatus,
    "schema_area" | "current_version" | "target_version"
  >[],
): string[] {
  return schemaVersions
    .filter((schema) => schema.current_version === null && schema.target_version !== null)
    .map((schema) => schema.schema_area)
    .sort((left, right) => left.localeCompare(right));
}
