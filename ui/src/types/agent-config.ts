/**
 * Agent Skills Configuration Types
 * 
 * These types define the structure for both:
 * - Multi-step agent workflows (based on task_config.yaml)
 * - Quick-start templates (formerly "Use Cases") - single-step prompts
 */

/**
 * Difficulty level for workflows
 */
export type WorkflowDifficulty = "beginner" | "intermediate" | "advanced";

/**
 * Visibility level for skills/agent configs
 *
 * - "private":  Only the owner can see and use this skill
 * - "team":     Owner + members of shared_with_teams can see it
 * - "global":   All authenticated users can see it
 */
export type SkillVisibility = "private" | "team" | "global";

/**
 * Input field for user forms (used in quick-start templates)
 */
export interface WorkflowInputField {
  name: string;
  label: string;
  placeholder: string;
  type: "text" | "url" | "number";
  required?: boolean;
  defaultValue?: string;
  helperText?: string;
}

/**
 * Input form configuration for workflows with placeholders
 */
export interface WorkflowInputForm {
  title: string;
  description?: string;
  fields: WorkflowInputField[];
  submitLabel?: string;
}

/**
 * A single task step within an agent configuration
 */
export interface AgentConfigTask {
  /** UI label displayed for this step */
  display_text: string;
  /** LLM prompt template with {variable} or {{variable}} placeholders for substitution */
  llm_prompt: string;
  /** Target subagent to execute this task (caipe, github, aws, argocd, aigateway, webex, jira) */
  subagent: AgentConfigSubagent;
}

/**
 * Available subagent types that can execute tasks
 */
export type AgentConfigSubagent = 
  | "caipe"      // User input collection via forms
  | "github"    // GitHub operations via gh CLI
  | "aws"       // AWS resource provisioning
  | "argocd"    // ArgoCD deployments
  | "aigateway" // LLM API key management
  | "webex"     // Webex notifications
  | "jira"      // Jira ticket operations
  | string;     // Allow custom subagents

/**
 * Categories for organizing agent configurations
 */
export type AgentConfigCategory =
  | "GitHub Operations"
  | "AWS Operations"
  | "ArgoCD Operations"
  | "AI Gateway Operations"
  | "Group Management"
  | "DevOps"
  | "Development"
  | "Operations"
  | "Cloud"
  | "Project Management"
  | "Security"
  | "Infrastructure"
  | "Knowledge"
  | "Custom";

/**
 * Metadata for an agent configuration
 */
export interface AgentConfigMetadata {
  /** Environment variables required for this config to work */
  env_vars_required?: string[];
  /** Estimated duration for the workflow (e.g., "2-5 minutes") */
  estimated_duration?: string;
  /** Version of the config schema */
  schema_version?: string;
  /** Tags for filtering/searching */
  tags?: string[];
  /** Expected agents/integrations used (for display) */
  expected_agents?: string[];
  /** (Experimental) Tool allowlist for this skill -- not enforced by backend yet */
  allowed_tools?: string[];
}

/**
 * Main agent configuration interface
 * Represents both multi-step workflows and quick-start templates
 */
export interface AgentConfig {
  /** Unique identifier */
  id: string;
  /** Display name (e.g., "Create GitHub Repo") */
  name: string;
  /** Optional description of what this workflow does */
  description?: string;
  /** Category for organization */
  category: AgentConfigCategory | string;
  /** Ordered list of tasks to execute */
  tasks: AgentConfigTask[];
  /** Owner's email address (for user-created configs) */
  owner_id: string;
  /** Whether this is a system/built-in config (cannot be deleted by users) */
  is_system: boolean;
  /** Creation timestamp */
  created_at: Date;
  /** Last update timestamp */
  updated_at: Date;
  /** Additional metadata */
  metadata?: AgentConfigMetadata;
  
  // Quick-start template fields (for single-step workflows)
  /** Whether this is a quick-start template (single prompt, executes in chat) */
  is_quick_start?: boolean;
  /** Difficulty level for the workflow */
  difficulty?: WorkflowDifficulty;
  /** Icon name for display (e.g., "GitBranch", "Server", "Cloud") */
  thumbnail?: string;
  /** Custom input form for placeholder-based prompts */
  input_form?: WorkflowInputForm;
  /** Raw SKILL.md markdown content for skills built with the Skills Builder */
  skill_content?: string;
  /** Visibility level: private (owner only), team (shared teams), global (everyone) */
  visibility?: SkillVisibility;
  /** Team IDs this skill is shared with (when visibility is "team") */
  shared_with_teams?: string[];
}

/**
 * Input for creating a new agent configuration
 */
export interface CreateAgentConfigInput {
  name: string;
  description?: string;
  category: AgentConfigCategory | string;
  tasks: AgentConfigTask[];
  metadata?: AgentConfigMetadata;
  // Quick-start fields
  is_quick_start?: boolean;
  difficulty?: WorkflowDifficulty;
  thumbnail?: string;
  input_form?: WorkflowInputForm;
  /** Raw SKILL.md markdown content */
  skill_content?: string;
  /** Visibility level: private (default), team, or global */
  visibility?: SkillVisibility;
  /** Team IDs to share with (when visibility is "team") */
  shared_with_teams?: string[];
}

/**
 * Input for updating an existing agent configuration
 */
export interface UpdateAgentConfigInput {
  name?: string;
  description?: string;
  category?: AgentConfigCategory | string;
  tasks?: AgentConfigTask[];
  metadata?: AgentConfigMetadata;
  // Quick-start fields
  is_quick_start?: boolean;
  difficulty?: WorkflowDifficulty;
  thumbnail?: string;
  input_form?: WorkflowInputForm;
  /** Raw SKILL.md markdown content */
  skill_content?: string;
  /** Visibility level: private, team, or global */
  visibility?: SkillVisibility;
  /** Team IDs to share with (when visibility is "team") */
  shared_with_teams?: string[];
}

/**
 * Execution status for a task step
 */
export type TaskExecutionStatus = 
  | "pending"     // Not yet started
  | "in_progress" // Currently executing
  | "completed"   // Successfully finished
  | "failed"      // Execution failed
  | "skipped";    // Skipped due to condition

/**
 * Runtime state for a task during execution
 */
export interface TaskExecutionState {
  /** Task index in the workflow */
  taskIndex: number;
  /** Current status */
  status: TaskExecutionStatus;
  /** Start timestamp */
  startedAt?: Date;
  /** Completion timestamp */
  completedAt?: Date;
  /** Error message if failed */
  error?: string;
  /** Output/result from the task */
  output?: string;
}

/**
 * Runtime state for an entire workflow execution
 */
export interface WorkflowExecutionState {
  /** The config being executed */
  configId: string;
  /** Overall status */
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  /** Per-task execution states */
  taskStates: TaskExecutionState[];
  /** Collected form data from user inputs */
  formData: Record<string, unknown>;
  /** Start timestamp */
  startedAt?: Date;
  /** Completion timestamp */
  completedAt?: Date;
}

/**
 * Parsed variable from an LLM prompt template
 */
export interface PromptVariable {
  /** Variable name (e.g., "repo_name") */
  name: string;
  /** Whether this variable is required */
  required: boolean;
  /** Description extracted from prompt context */
  description?: string;
  /** Default value if specified */
  defaultValue?: string;
  /** Validation options (e.g., allowed values) */
  options?: string[];
}

/**
 * Helper function to extract variables from an LLM prompt
 * Supports formats:
 *   {variable_name}          — required, no default
 *   {{variable_name}}        — required, no default
 *   {{variable_name:default}} — optional, pre-filled with "default"
 */
export function extractPromptVariables(prompt: string): PromptVariable[] {
  const singleBracePattern = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  // Capture inner content which may contain "name:default"
  const doubleBracePattern = /\{\{([^}]+)\}\}/g;
  
  const variables: PromptVariable[] = [];
  const seen = new Set<string>();
  
  let match;
  while ((match = singleBracePattern.exec(prompt)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      variables.push({ name, required: true });
    }
  }
  
  while ((match = doubleBracePattern.exec(prompt)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;

    const colonIdx = inner.indexOf(":");
    if (colonIdx !== -1) {
      const name = inner.substring(0, colonIdx).trim();
      const defaultValue = inner.substring(colonIdx + 1).trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        variables.push({ name, required: false, defaultValue });
      }
    } else {
      const name = inner;
      if (!seen.has(name)) {
        seen.add(name);
        variables.push({ name, required: true });
      }
    }
  }
  
  return variables;
}

/**
 * Extract placeholders from a prompt and generate an input form
 */
export function generateInputFormFromPrompt(
  prompt: string,
  title: string
): WorkflowInputForm | null {
  const variables = extractPromptVariables(prompt);
  if (variables.length === 0) return null;
  
  const fields: WorkflowInputField[] = variables.map((variable) => {
    // Convert variable name to label
    let label = variable.name
      .replace(/_/g, " ")
      .replace(/-/g, " ")
      .replace(/([A-Z])/g, " $1")
      .replace(/\s+/g, " ")
      .trim();
    
    // Capitalize first letter of each word
    label = label
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
    
    // Determine field type based on name
    let type: "text" | "url" | "number" = "text";
    const nameLower = variable.name.toLowerCase();
    if (nameLower.includes("url") || nameLower.includes("link")) {
      type = "url";
    } else if (nameLower.includes("count") || nameLower.includes("number")) {
      type = "number";
    }
    
    return {
      name: variable.name,
      label,
      placeholder: variable.defaultValue
        ? `Default: ${variable.defaultValue}`
        : `Enter ${label.toLowerCase()}`,
      type,
      required: variable.required,
      defaultValue: variable.defaultValue,
    };
  });
  
  return {
    title,
    description: `Please provide the following information`,
    fields,
    submitLabel: "Start",
  };
}

/**
 * Parse a task_config.yaml style object into AgentConfig array
 */
export function parseTaskConfigObject(
  config: Record<string, { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> }>,
  ownerId: string = "system"
): AgentConfig[] {
  const now = new Date();
  
  return Object.entries(config).map(([name, value]) => {
    // Infer category from name
    let category: AgentConfigCategory = "Custom";
    if (name.toLowerCase().includes("github") || name.toLowerCase().includes("repo")) {
      category = "GitHub Operations";
    } else if (name.toLowerCase().includes("aws") || name.toLowerCase().includes("ec2") || name.toLowerCase().includes("eks") || name.toLowerCase().includes("s3")) {
      category = "AWS Operations";
    } else if (name.toLowerCase().includes("argocd") || name.toLowerCase().includes("deploy")) {
      category = "ArgoCD Operations";
    } else if (name.toLowerCase().includes("llm") || name.toLowerCase().includes("api key") || name.toLowerCase().includes("aigateway")) {
      category = "AI Gateway Operations";
    } else if (name.toLowerCase().includes("group") || name.toLowerCase().includes("user")) {
      category = "Group Management";
    }
    
    // Extract env vars from prompts
    const envVarPattern = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
    const envVars = new Set<string>();
    value.tasks.forEach(task => {
      let match;
      while ((match = envVarPattern.exec(task.llm_prompt)) !== null) {
        envVars.add(match[1]);
      }
    });
    
    return {
      id: `config-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      name,
      description: `Multi-step workflow for: ${name}`,
      category,
      tasks: value.tasks.map(task => ({
        display_text: task.display_text,
        llm_prompt: task.llm_prompt,
        subagent: task.subagent as AgentConfigSubagent,
      })),
      owner_id: ownerId,
      is_system: ownerId === "system",
      created_at: now,
      updated_at: now,
      metadata: {
        env_vars_required: Array.from(envVars),
        schema_version: "1.0",
      },
    };
  });
}

/**
 * Built-in quick-start templates (formerly "Use Cases")
 * These are single-step prompts that execute directly in chat
 */
export const BUILTIN_QUICK_START_TEMPLATES: AgentConfig[] = [
  {
    id: "qs-deploy-status",
    name: "Check Deployment Status",
    description: "Get the current status of all ArgoCD applications and identify any that are out of sync or unhealthy.",
    category: "DevOps",
    tasks: [{
      display_text: "Check ArgoCD deployment status",
      llm_prompt: "Show me the status of all ArgoCD applications. Identify any that are OutOfSync or Degraded.",
      subagent: "argocd",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "beginner",
    thumbnail: "Server",
    metadata: {
      tags: ["ArgoCD", "Kubernetes", "Monitoring"],
      expected_agents: ["ArgoCD"],
    },
  },
  {
    id: "qs-pr-review",
    name: "Review Open Pull Requests",
    description: "List all open PRs across repositories with their review status and CI/CD results.",
    category: "Development",
    tasks: [{
      display_text: "List open pull requests",
      llm_prompt: "List all open pull requests in our repositories. Show review status and any failing checks.",
      subagent: "github",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "beginner",
    thumbnail: "GitBranch",
    metadata: {
      tags: ["GitHub", "Code Review", "CI/CD"],
      expected_agents: ["GitHub"],
    },
  },
  {
    id: "qs-review-specific-pr",
    name: "Review a Specific PR",
    description: "Get a detailed code review of a specific GitHub Pull Request including changes, comments, and recommendations.",
    category: "Development",
    tasks: [{
      display_text: "Review specific PR",
      llm_prompt: "Review the GitHub Pull Request at {{prUrl}}. Analyze the code changes, check for potential issues, review the test coverage, and provide a comprehensive code review summary with recommendations.",
      subagent: "github",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "intermediate",
    thumbnail: "GitPullRequest",
    metadata: {
      tags: ["GitHub", "Code Review", "PR Analysis"],
      expected_agents: ["GitHub"],
    },
    input_form: {
      title: "Review a GitHub Pull Request",
      description: "Enter the PR URL or repository details to get a comprehensive code review.",
      fields: [{
        name: "prUrl",
        label: "PR URL or Link",
        placeholder: "https://github.com/owner/repo/pull/123",
        type: "url",
        required: true,
        helperText: "Paste the full GitHub PR URL (e.g., https://github.com/cnoe-io/ai-platform-engineering/pull/42)",
      }],
      submitLabel: "Start Review",
    },
  },
  {
    id: "qs-incident-analysis",
    name: "Incident Investigation",
    description: "Correlate PagerDuty incidents with related Jira tickets and recent deployments.",
    category: "Operations",
    tasks: [{
      display_text: "Investigate incidents",
      llm_prompt: "Show me active PagerDuty incidents and find related Jira tickets. Also check if there were any recent deployments that might be related.",
      subagent: "caipe",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "advanced",
    thumbnail: "AlertTriangle",
    metadata: {
      tags: ["PagerDuty", "Jira", "ArgoCD", "Multi-Agent"],
      expected_agents: ["PagerDuty", "Jira", "ArgoCD"],
    },
  },
  {
    id: "qs-cost-analysis",
    name: "AWS Cost Analysis",
    description: "Analyze AWS costs by service and identify opportunities for optimization.",
    category: "Cloud",
    tasks: [{
      display_text: "Analyze AWS costs",
      llm_prompt: "Show me the AWS cost breakdown for the last month. Identify the top 5 most expensive services and any cost anomalies.",
      subagent: "aws",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "intermediate",
    thumbnail: "Cloud",
    metadata: {
      tags: ["AWS", "Cost", "Optimization"],
      expected_agents: ["AWS"],
    },
  },
  {
    id: "qs-sprint-report",
    name: "Sprint Progress Report",
    description: "Generate a comprehensive sprint report with velocity metrics and burndown analysis.",
    category: "Project Management",
    tasks: [{
      display_text: "Generate sprint report",
      llm_prompt: "Generate a sprint progress report for the current sprint. Show velocity, burndown, and identify any blockers.",
      subagent: "jira",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "intermediate",
    thumbnail: "BarChart",
    metadata: {
      tags: ["Jira", "Agile", "Reporting"],
      expected_agents: ["Jira"],
    },
  },
  {
    id: "qs-oncall-handoff",
    name: "On-Call Handoff",
    description: "Generate a comprehensive handoff document for on-call rotation.",
    category: "Operations",
    tasks: [{
      display_text: "Generate on-call handoff",
      llm_prompt: "Generate an on-call handoff document. Include open incidents, ongoing issues, recent deployments, and any systems to watch.",
      subagent: "caipe",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "advanced",
    thumbnail: "Users",
    metadata: {
      tags: ["PagerDuty", "Jira", "ArgoCD", "Multi-Agent"],
      expected_agents: ["PagerDuty", "Jira", "ArgoCD"],
    },
  },
  {
    id: "qs-security-scan",
    name: "Security Vulnerability Report",
    description: "Check for security vulnerabilities in GitHub repositories and Dependabot alerts.",
    category: "Security",
    tasks: [{
      display_text: "Check security vulnerabilities",
      llm_prompt: "Check all repositories for security vulnerabilities. Show Dependabot alerts and code scanning results.",
      subagent: "github",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "intermediate",
    thumbnail: "Shield",
    metadata: {
      tags: ["GitHub", "Security", "Dependabot"],
      expected_agents: ["GitHub"],
    },
  },
  {
    id: "qs-resource-health",
    name: "Cluster Resource Health",
    description: "Check Kubernetes cluster health including pod status, resource utilization, and alerts.",
    category: "Infrastructure",
    tasks: [{
      display_text: "Check cluster health",
      llm_prompt: "Check the health of our EKS clusters. Show any failing pods, resource constraints, or pending alerts.",
      subagent: "aws",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "intermediate",
    thumbnail: "Database",
    metadata: {
      tags: ["AWS", "Kubernetes", "Monitoring"],
      expected_agents: ["AWS"],
    },
  },
  {
    id: "qs-release-readiness",
    name: "Release Readiness Check",
    description: "Verify all prerequisites are met before a release: PRs merged, tests passing, environments healthy.",
    category: "DevOps",
    tasks: [{
      display_text: "Check release readiness",
      llm_prompt: "Check if we're ready for a release. Verify all PRs are merged, tests are passing, staging environment is healthy, and no blocking issues exist.",
      subagent: "caipe",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "advanced",
    thumbnail: "Rocket",
    metadata: {
      tags: ["GitHub", "ArgoCD", "Jira", "Multi-Agent"],
      expected_agents: ["GitHub", "ArgoCD", "Jira"],
    },
  },
  {
    id: "qs-knowledge-search",
    name: "Documentation Search",
    description: "Search internal knowledge base for runbooks, architecture docs, and best practices.",
    category: "Knowledge",
    tasks: [{
      display_text: "Search knowledge base",
      llm_prompt: "Search our knowledge base for information about our deployment process and best practices.",
      subagent: "caipe",
    }],
    owner_id: "system",
    is_system: true,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    is_quick_start: true,
    difficulty: "beginner",
    thumbnail: "Zap",
    metadata: {
      tags: ["RAG", "Documentation"],
      expected_agents: ["RAG"],
    },
  },
];

// ---------------------------------------------------------------------------
// Skill Metrics Types
// ---------------------------------------------------------------------------

export interface SkillRunStats {
  skill_id: string;
  skill_name: string;
  total_runs: number;
  completed: number;
  failed: number;
  success_rate: number;
  last_run: string | null;
  avg_duration_ms: number | null;
}

export interface SkillMetricsPersonal {
  total_skills: number;
  by_visibility: { private: number; team: number; global: number };
  by_category: Array<{ category: string; count: number }>;
  recent_skills: Array<{
    id: string;
    name: string;
    visibility: SkillVisibility;
    category: string;
    created_at: string;
  }>;
  run_stats: SkillRunStats[];
  daily_created: Array<{ date: string; count: number }>;
}

export interface SkillMetricsAdmin {
  total_skills: number;
  system_skills: number;
  user_skills: number;
  by_visibility: { private: number; team: number; global: number };
  by_category: Array<{ category: string; count: number }>;
  top_creators: Array<{ email: string; count: number }>;
  daily_created: Array<{ date: string; count: number }>;
  top_skills_by_runs: SkillRunStats[];
  overall_run_stats: {
    total_runs: number;
    completed: number;
    failed: number;
    success_rate: number;
    avg_duration_ms: number | null;
  };
}
