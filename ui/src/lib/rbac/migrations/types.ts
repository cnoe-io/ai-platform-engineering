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
  implemented: boolean;
  dependencies?: string[];
}

export interface MigrationListItem extends MigrationDefinition {
  current_version: number | null;
  target_version: number;
  status: MigrationStatus;
  last_run_at?: string;
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
