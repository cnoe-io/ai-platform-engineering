// assisted-by Codex Codex-sonnet-4-6

export interface RbacSelfCheckTuple {
  user: string;
  relation: string;
  object: string;
}

export type RbacSelfCheckFindingSeverity = "missing" | "stale_reference" | "orphan_candidate";
export type RbacSelfCheckStatus = "pass" | "warn" | "fail";

export interface RbacSelfCheckFinding {
  id: string;
  severity: RbacSelfCheckFindingSeverity;
  source: string;
  title: string;
  detail: string;
  fix: string;
  tuple?: RbacSelfCheckTuple;
  repairable: boolean;
  review_action?: {
    type: "revoke_tuple";
    label: string;
    reason: string;
  };
  resource?: {
    type: string;
    id: string;
    label?: string;
  };
}

export interface RbacSelfCheckRepairBatch {
  source: string;
  finding_count: number;
  repairable_count: number;
  action_label: string;
  guidance: string;
}

export interface RbacSelfCheckReport {
  generated_at: string;
  status: RbacSelfCheckStatus;
  scope?: {
    selected: string[];
    labels: string[];
    all: boolean;
  };
  inventory: {
    mongo: Record<string, number>;
    openfga_tuple_count: number;
    openfga_tuples_by_object_type: Record<string, number>;
    organization_capability_tuples: string[];
  };
  summary: {
    expected_tuples: number;
    missing_tuples: number;
    stale_references: number;
    orphan_candidates: number;
    repairable_findings: number;
    total_findings: number;
  };
  expected_by_source: Record<string, number>;
  missing_by_source: Record<string, number>;
  findings: RbacSelfCheckFinding[];
  repair_batches: RbacSelfCheckRepairBatch[];
  notes: string[];
}

export interface RbacSelfCheckRepairResult {
  requested_sources: string[];
  attempted_writes: number;
  applied_writes: number;
  skipped_findings: number;
}

export interface RbacSelfCheckRevokeResult {
  attempted_deletes: number;
  applied_deletes: number;
  skipped_findings: number;
  tuple: RbacSelfCheckTuple;
}

export interface RbacSelfCheckBulkRevokeResult {
  requested_deletes: number;
  attempted_deletes: number;
  applied_deletes: number;
  skipped_deletes: number;
}

export interface RbacSelfCheckCleanupResult {
  matched_rows: number;
  modified_rows: number;
  attempted_tuple_deletes: number;
  applied_tuple_deletes: number;
}

export type RbacSelfCheckTestActorKey =
  | "org_admin"
  | "member_user"
  | "service_account"
  | "unlinked_service_account";

export type RbacSelfCheckTestSuiteId =
  | "team_memberships"
  | "credentials"
  | "mcp_servers"
  | "data_sources"
  | "knowledge_bases"
  | "agents"
  | "agent_tools"
  | "skills"
  | "llm_models"
  | "service_accounts"
  | "slack"
  | "webex"
  | "workflows"
  | "chat_sre_agent"
  | "custom_assertions";

export type RbacSelfCheckTestCaseStatus = "pass" | "fail" | "blocked" | "skip";

export interface RbacSelfCheckTestActor {
  key: RbacSelfCheckTestActorKey;
  label: string;
  subject_type: "user" | "service_account";
  subject_id?: string;
  source: "request" | "session" | "env" | "inventory" | "unlinked-service-account" | "unresolved";
  resolved: boolean;
  team_slugs?: string[];
}

export interface RbacSelfCheckTestResource {
  type: string;
  id: string;
  label?: string;
  source?: string;
}

export interface RbacSelfCheckTestCheck {
  id: string;
  title: string;
  status: RbacSelfCheckTestCaseStatus;
  detail: string;
  actor?: RbacSelfCheckTestActor;
  resource?: RbacSelfCheckTestResource;
  action?: string;
  expected?: "ALLOW" | "DENY";
  actual?: "ALLOW" | "DENY";
  tuple?: RbacSelfCheckTuple;
  fix?: string;
}

export interface RbacSelfCheckTestCase {
  id: string;
  title: string;
  status: RbacSelfCheckTestCaseStatus;
  checks: RbacSelfCheckTestCheck[];
}

export interface RbacSelfCheckTestSuite {
  id: RbacSelfCheckTestSuiteId;
  label: string;
  description: string;
  status: RbacSelfCheckTestCaseStatus;
  cases: RbacSelfCheckTestCase[];
}

export interface RbacSelfCheckTestSuiteDefinition {
  id: RbacSelfCheckTestSuiteId;
  label: string;
  description: string;
  default_enabled: boolean;
}

export interface RbacSelfCheckAssertionInput {
  id?: string;
  title?: string;
  actor: {
    type: "user" | "service_account";
    id: string;
    label?: string;
  };
  resource: {
    type: string;
    id: string;
    label?: string;
  };
  action: string;
  expect: "ALLOW" | "DENY";
}

export interface RbacSelfCheckTestReport {
  generated_at: string;
  status: RbacSelfCheckStatus;
  summary: {
    suites: number;
    cases: number;
    checks: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    duration_ms: number;
  };
  actors: RbacSelfCheckTestActor[];
  suites: RbacSelfCheckTestSuite[];
  self_check_status: RbacSelfCheckStatus;
  notes: string[];
}
