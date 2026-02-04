/**
 * Workflow Run Types
 * 
 * Tracks the execution history of agent builder workflows.
 * Used for history views, debugging, and re-running workflows.
 */

export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface ExecutionStep {
  id: string;
  agent: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  order: number;
}

export interface ToolCall {
  id: string;
  tool: string;
  description: string;
  agent: string;
  status: "running" | "completed";
  timestamp: number;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workflow_name: string;
  workflow_category?: string;
  status: WorkflowRunStatus;
  started_at: Date | string;
  completed_at?: Date | string;
  duration_ms?: number;
  
  // Input/Output
  input_parameters?: Record<string, string>;
  input_prompt?: string; // The actual prompt that was executed
  result_summary?: string;
  error_message?: string;
  
  // Execution details (basic counts for summary)
  steps_completed?: number;
  steps_total?: number;
  tools_called?: string[]; // List of tools that were invoked
  
  // Full execution artifacts (for replay/view)
  execution_artifacts?: {
    steps: ExecutionStep[];
    tool_calls: ToolCall[];
    streaming_content?: string;
  };
  
  // Ownership
  owner_id: string;
  
  // Metadata
  created_at: Date | string;
  metadata?: {
    agent_version?: string;
    model?: string;
    tags?: string[];
  };
  
  // MongoDB
  _id?: any;
}

export interface CreateWorkflowRunInput {
  workflow_id: string;
  workflow_name: string;
  workflow_category?: string;
  input_parameters?: Record<string, string>;
  input_prompt?: string;
  metadata?: {
    agent_version?: string;
    model?: string;
    tags?: string[];
  };
}

export interface UpdateWorkflowRunInput {
  status?: WorkflowRunStatus;
  completed_at?: Date | string;
  duration_ms?: number;
  result_summary?: string;
  error_message?: string;
  steps_completed?: number;
  steps_total?: number;
  tools_called?: string[];
  execution_artifacts?: {
    steps: ExecutionStep[];
    tool_calls: ToolCall[];
    streaming_content?: string;
  };
}

export interface WorkflowRunFilters {
  workflow_id?: string;
  status?: WorkflowRunStatus;
  owner_id?: string;
  from_date?: Date | string;
  to_date?: Date | string;
  limit?: number;
}
