/**
 * Task Config Types
 *
 * Types for the Task Builder feature. Task configs define multi-step
 * self-service workflows that the supervisor agent executes deterministically.
 * These mirror the task_config.yaml schema with additional metadata for
 * MongoDB persistence and UI management.
 */

/**
 * Visibility level for task configs
 */
export type TaskConfigVisibility = "private" | "team" | "global";

/**
 * Available subagent types that can execute task steps
 */
export type TaskConfigSubagent =
  | "user_input"
  | "github"
  | "backstage"
  | "aws"
  | "argocd"
  | "aigateway"
  | "webex"
  | "jira"
  | string;

/**
 * Categories for organizing task configs (matches task_config.yaml sections)
 */
export type TaskConfigCategory =
  | "GitHub Operations"
  | "AWS Operations"
  | "ArgoCD Operations"
  | "AI Gateway Operations"
  | "Group Management"
  | "Custom";

/**
 * A single step within a task config workflow
 */
export interface TaskStep {
  /** UI label displayed for this step */
  display_text: string;
  /** LLM prompt template with ${VAR_NAME} environment variable substitution */
  llm_prompt: string;
  /** Target subagent to execute this step */
  subagent: TaskConfigSubagent;
}

/**
 * Metadata for a task config
 */
export interface TaskConfigMetadata {
  /** Environment variables required for this workflow (extracted from prompts) */
  env_vars_required?: string[];
  /** Estimated duration for the workflow (e.g., "2-5 minutes") */
  estimated_duration?: string;
  /** Tags for filtering/searching */
  tags?: string[];
  /** Tool allowlist for custom (non-system) workflows. Empty/undefined = allow all. */
  allowed_tools?: string[];
}

/**
 * Main task config interface — stored in MongoDB task_configs collection
 */
export interface TaskConfig {
  /** Unique identifier */
  id: string;
  /** Workflow name (unique), e.g. "Create GitHub Repo" */
  name: string;
  /** Category for organization */
  category: TaskConfigCategory | string;
  /** Optional description */
  description?: string;
  /** Ordered list of workflow steps */
  tasks: TaskStep[];
  /** Owner: "system" for YAML-seeded, user email for custom */
  owner_id: string;
  /** True for YAML-seeded configs */
  is_system: boolean;
  /** Visibility level */
  visibility: TaskConfigVisibility;
  /** Team IDs this config is shared with (when visibility is "team") */
  shared_with_teams?: string[];
  /** Additional metadata */
  metadata?: TaskConfigMetadata;
  /** Creation timestamp */
  created_at: Date;
  /** Last update timestamp */
  updated_at: Date;
}

/**
 * Input for creating a new task config
 */
export interface CreateTaskConfigInput {
  name: string;
  category: TaskConfigCategory | string;
  description?: string;
  tasks: TaskStep[];
  metadata?: TaskConfigMetadata;
  visibility?: TaskConfigVisibility;
  shared_with_teams?: string[];
}

/**
 * Input for updating an existing task config
 */
export interface UpdateTaskConfigInput {
  name?: string;
  category?: TaskConfigCategory | string;
  description?: string;
  tasks?: TaskStep[];
  metadata?: TaskConfigMetadata;
  visibility?: TaskConfigVisibility;
  shared_with_teams?: string[];
}

// ---------------------------------------------------------------------------
// File I/O extraction (Feature 1)
// ---------------------------------------------------------------------------

export interface FileIO {
  reads: string[];
  writes: string[];
}

/**
 * Extract filesystem paths that a step reads from and writes to.
 * Matches patterns like "Read /request.txt", "Write to /result.txt",
 * "Save ... to /template.yml", "content to /processed_ec2.tf", etc.
 */
export function extractFileIO(prompt: string): FileIO {
  const reads = new Set<string>();
  const writes = new Set<string>();

  const readPatterns = [
    /[Rr]ead\s+(\/[\w./-]+)/g,
    /from\s+(\/[\w./-]+)/g,
    /content (?:of|from)\s+(\/[\w./-]+)/g,
  ];
  const writePatterns = [
    /[Ww]rite\s+(?:.*?\s+)?(?:to\s+)?(\/[\w./-]+)/g,
    /[Ss]ave\s+(?:.*?\s+)?(?:to\s+)?(\/[\w./-]+)/g,
    /[Ww]rite\s+"[^"]*"\s+to\s+(\/[\w./-]+)/g,
  ];

  for (const pat of readPatterns) {
    let m;
    while ((m = pat.exec(prompt)) !== null) reads.add(m[1]);
  }
  for (const pat of writePatterns) {
    let m;
    while ((m = pat.exec(prompt)) !== null) writes.add(m[1]);
  }

  return { reads: Array.from(reads), writes: Array.from(writes) };
}

// ---------------------------------------------------------------------------
// CAIPE form field types (Feature 2)
// ---------------------------------------------------------------------------

export interface CaipeFormField {
  name: string;
  required: boolean;
  description: string;
  default_value?: string;
  field_values?: string[];
  auto_filled?: boolean;
}

/**
 * Parse existing CAIPE prompt text into structured form fields.
 * Matches lines like:
 *   - repo_name (required): Repository name (default: foo, field_values: ["a","b"])
 */
export function parseCaipeFields(prompt: string): CaipeFormField[] {
  const fields: CaipeFormField[] = [];
  const linePattern = /- (\w+)\s+\((required|optional)\):\s*(.+)/g;
  let m;
  while ((m = linePattern.exec(prompt)) !== null) {
    const [, name, reqOpt, rest] = m;
    let description = rest;
    let default_value: string | undefined;
    let field_values: string[] | undefined;

    const defMatch = rest.match(/\(default:\s*([^,)]+)/);
    if (defMatch) default_value = defMatch[1].trim();

    const fvMatch = rest.match(/field_values:\s*(\[[^\]]*\])/);
    if (fvMatch) {
      try {
        field_values = JSON.parse(fvMatch[1].replace(/'/g, '"'));
      } catch { /* leave undefined */ }
    }
    const fvEnvMatch = rest.match(/field_values:\s*(\$\{[^}]+\})/);
    if (fvEnvMatch) {
      field_values = [fvEnvMatch[1]];
    }

    const descEnd = rest.indexOf("(");
    if (descEnd > 0) description = rest.slice(0, descEnd).trim();

    fields.push({
      name,
      required: reqOpt === "required",
      description,
      default_value,
      field_values,
      auto_filled: false,
    });
  }
  return fields;
}

/**
 * Generate a CAIPE prompt from structured form fields.
 */
export function generateCaipePrompt(fields: CaipeFormField[], outputFile: string): string {
  const lines = [
    "Collect the following information from the user and write to " + outputFile + ":",
  ];
  for (const f of fields) {
    if (f.auto_filled) continue;
    let line = `- ${f.name} (${f.required ? "required" : "optional"}): ${f.description}`;
    const extras: string[] = [];
    if (f.default_value) extras.push(`default: ${f.default_value}`);
    if (f.field_values && f.field_values.length > 0) {
      extras.push(`field_values: ${JSON.stringify(f.field_values)}`);
    }
    if (extras.length > 0) line += ` (${extras.join(", ")})`;
    lines.push(line);
  }
  lines.push("");
  lines.push("user_email is auto-filled from the authenticated session — do NOT include it in the form.");
  lines.push("");
  lines.push("Format as key=value on each line. Write to " + outputFile + ".");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Step templates (Feature 3)
// ---------------------------------------------------------------------------

export interface StepTemplate {
  id: string;
  label: string;
  subagent: TaskConfigSubagent;
  display_text: string;
  llm_prompt: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Environment variable registry (Feature 4)
// ---------------------------------------------------------------------------

export interface EnvVarInfo {
  name: string;
  description: string;
}

export const KNOWN_ENV_VARS: Record<string, string> = {
  GITHUB_ORGS: "Comma-separated list of allowed GitHub organizations",
  WORKFLOWS_REPO: "Repository containing GitHub Actions workflows (org/repo)",
  JARVIS_WORKFLOWS_REPO: "Jarvis workflows repository with templates (org/repo)",
  TERRAFORM_INFRA_REPO: "Terraform infrastructure repository (org/repo)",
  ADMIN_REPO: "Admin repository for safe-settings (org/admin)",
  GROUPS_AUTOMATION_REPO: "Repository for group management automation (org/repo)",
  GROUPS_TEAMS_PATH: "Path prefix for teams directory in the automation repo",
  ORG_MEMBERSHIP_FILE_PATTERN: "File path pattern for org membership YAML",
  DEFAULT_AWS_REGIONS: "Comma-separated list of allowed AWS regions",
  EMAIL_DOMAIN: "Corporate email domain (e.g., company.com)",
  DEFAULT_GITHUB_ORG: "Default GitHub organization name",
  JIRA_ASSIGNEE: "Default Jira ticket assignee email",
  DEFAULT_VPC_NAME: "Default VPC name for AWS resources",
  DEFAULT_AWS_ACCOUNT: "Default AWS account name",
  DEFAULT_APPLICATION_NAME: "Default application name tag for AWS resources",
  DATA_CLASSIFICATION: "Data classification tag value",
  DATA_TAXONOMY: "Data taxonomy tag value",
  TF_STATE_BUCKET_NONPROD: "Terraform state bucket for dev/staging",
  TF_STATE_BUCKET_SANDBOX: "Terraform state bucket for sandbox",
  TF_STATE_BUCKET_PROD: "Terraform state bucket for production",
  WEBEX_TOKEN: "Webex API token",
  WEBEX_ROOM_ID: "Default Webex room ID for notifications",
  DEFAULT_CLUSTER_NAME: "Default Kubernetes cluster name",
  DEFAULT_CLUSTER_ADDRESS: "Default Kubernetes cluster address",
  MONGODB_URI: "MongoDB connection URI",
  MONGODB_DATABASE: "MongoDB database name",
};

/**
 * Extract env vars from all steps with step-index references.
 */
export function extractEnvVarsWithSteps(
  tasks: TaskStep[]
): { name: string; description: string; steps: number[] }[] {
  const map = new Map<string, number[]>();
  const envVarPattern = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
  tasks.forEach((task, i) => {
    let m;
    while ((m = envVarPattern.exec(task.llm_prompt)) !== null) {
      const v = m[1];
      if (!map.has(v)) map.set(v, []);
      map.get(v)!.push(i);
    }
  });
  return Array.from(map.entries()).map(([name, steps]) => ({
    name,
    description: KNOWN_ENV_VARS[name] || "Unknown variable",
    steps,
  }));
}

// ---------------------------------------------------------------------------
// Original helpers
// ---------------------------------------------------------------------------

/**
 * Infer category from a workflow name (used during YAML seeding)
 */
export function inferCategory(name: string): TaskConfigCategory {
  const lower = name.toLowerCase();
  if (lower.includes("github") || lower.includes("repo")) return "GitHub Operations";
  if (lower.includes("ec2") || lower.includes("eks") || lower.includes("s3")) return "AWS Operations";
  if (lower.includes("argocd") || lower.includes("deploy")) return "ArgoCD Operations";
  if (lower.includes("llm") || lower.includes("api key") || lower.includes("aigateway")) return "AI Gateway Operations";
  if (lower.includes("group") || lower.includes("user") || lower.includes("invite")) return "Group Management";
  return "Custom";
}

/**
 * Extract ${VAR_NAME} environment variable references from task prompts
 */
export function extractEnvVars(tasks: TaskStep[]): string[] {
  const envVarPattern = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
  const envVars = new Set<string>();
  for (const task of tasks) {
    let match;
    while ((match = envVarPattern.exec(task.llm_prompt)) !== null) {
      envVars.add(match[1]);
    }
  }
  return Array.from(envVars);
}

/**
 * Parse a task_config.yaml-style object into TaskConfig array
 */
export function parseTaskConfigYaml(
  config: Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }>
): TaskConfig[] {
  const now = new Date();

  return Object.entries(config).map(([name, value]) => {
    const tasks: TaskStep[] = value.tasks.map((t) => ({
      display_text: t.display_text,
      llm_prompt: t.llm_prompt,
      subagent: t.subagent,
    }));

    return {
      id: `task-config-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      name,
      category: inferCategory(name),
      description: `Self-service workflow: ${name}`,
      tasks,
      owner_id: "system",
      is_system: true,
      visibility: "global" as TaskConfigVisibility,
      metadata: {
        env_vars_required: extractEnvVars(tasks),
      },
      created_at: now,
      updated_at: now,
    };
  });
}

/**
 * Convert TaskConfig documents back into task_config.yaml format
 */
export function toTaskConfigYamlFormat(
  configs: TaskConfig[]
): Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }> {
  const result: Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }> = {};
  for (const config of configs) {
    result[config.name] = {
      tasks: config.tasks.map((t) => ({
        display_text: t.display_text,
        llm_prompt: t.llm_prompt,
        subagent: t.subagent,
      })),
    };
  }
  return result;
}
