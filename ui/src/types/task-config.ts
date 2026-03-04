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
  | "caipe"
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
