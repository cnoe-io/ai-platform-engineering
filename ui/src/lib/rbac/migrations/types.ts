export type MigrationKind = "implicit" | "explicit" | "index";

export type MigrationStatus = "not_started" | "planned" | "running" | "completed" | "failed";

export interface MigrationDefinition {
  id: string;
  release: string;
  schema_area: string;
  from_version: number;
  to_version: number;
  kind: MigrationKind;
  title: string;
  description: string;
  confirmation: string;
  required: boolean;
  blocking?: boolean;
  implemented: boolean;
  dependencies?: string[];
}

export interface MigrationListItem extends MigrationDefinition {
  current_version: number | null;
  target_version: number;
  status: MigrationStatus;
  last_run_at?: string;
}

export interface MigrationSchemaVersionStatus {
  schema_area: string;
  current_version: number | null;
  target_version: number | null;
  status: "current" | "behind" | "unknown";
  last_migration_id?: string;
}

export interface MigrationRuntimeStatus {
  migration_release: string;
  manifest_count: number;
}

export interface MigrationListResult {
  release: string;
  runtime: MigrationRuntimeStatus;
  schema_versions: MigrationSchemaVersionStatus[];
  migrations: MigrationListItem[];
  completed_migrations: MigrationListItem[];
}

export interface MigrationBlockingStatus {
  release: string;
  runtime: MigrationRuntimeStatus;
  schema_versions: MigrationSchemaVersionStatus[];
  pending_required_count: number;
  blocking_required_count: number;
  version_bootstrap_required_count: number;
  version_bootstrap_schema_areas: string[];
  needs_version_bootstrap: boolean;
  requires_attention: boolean;
  is_blocking: boolean;
  override_active: boolean;
  override_reason?: string;
  override_expires_at?: string;
}

export interface MigrationSampleDiff {
  collection: string;
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface MigrationPlanResult {
  migration_id: string;
  release: string;
  schema_area: string;
  kind: MigrationKind;
  from_version: number;
  to_version: number;
  counts: Record<string, number>;
  warnings: string[];
  sample_diffs: MigrationSampleDiff[];
  tuple_writes_planned: number;
  confirmation: string;
}

export interface MigrationApplyResult extends MigrationPlanResult {
  applied_counts: Record<string, number>;
  applied_at: string;
  applied_by: string;
}

export interface SchemaVersionBootstrapPlanResult {
  migration_id: string;
  release: string;
  schema_areas: string[];
  counts: Record<string, number>;
  warnings: string[];
  confirmation: string;
}

export interface SchemaVersionBootstrapApplyResult extends SchemaVersionBootstrapPlanResult {
  applied_counts: Record<string, number>;
  applied_at: string;
  applied_by: string;
}
