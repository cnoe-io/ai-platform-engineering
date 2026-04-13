/**
 * Shared parsing helpers for A2A timeline events.
 *
 * Used by ChatPanel (streaming loop) and TimelineManager.
 * Parses structured DataPart plans emitted by the backend.
 */

import type { PlanStep, Artifact } from "@/types/a2a";

// ─── Plan Step Parsing ───────────────────────────────────────────────────────

/**
 * Legacy A2A DataPart step format emitted by the Supervisor.
 */
interface DataPartStep {
  step_id?: string;
  title?: string;
  agent?: string;
  status?: string;
  order?: number;
  /** AG-UI / LangGraph state shape: step uses `id` instead of `step_id` */
  id?: string;
  /** AG-UI / LangGraph state shape: step uses `description` instead of `title` */
  description?: string;
}

interface PlanData {
  steps?: DataPartStep[];
}

/**
 * Parse plan steps from a structured data object.
 *
 * Supports two formats:
 * 1. Legacy A2A DataPart: `{ steps: [{ step_id, title, agent, status, order }] }`
 *    Emitted by the Supervisor via A2A execution_plan_update artifacts.
 * 2. AG-UI STATE_DELTA format: `{ steps: [{ id, description, agent, status }] }`
 *    Produced when the chat store processes LangGraph state patches.
 *
 * Returns empty array if data doesn't contain valid plan steps.
 */
export function parsePlanStepsFromData(data: unknown): PlanStep[] {
  if (!data || typeof data !== "object") return [];
  const planData = data as PlanData;
  if (!Array.isArray(planData.steps)) return [];

  return planData.steps.map((s, idx) => ({
    // Prefer AG-UI `id` field, fall back to legacy `step_id`, then index-based
    id: s.id || s.step_id || `step-${s.order ?? idx}`,
    agent: s.agent || "Supervisor",
    // Prefer AG-UI `description` field, fall back to legacy `title`
    description: s.description || s.title || "",
    status: normalizePlanStatus(s.status || "pending"),
  }));
}

/**
 * Convert `todos` array from LangGraph write_todos (via STATE_SNAPSHOT)
 * into PlanStep[] for timeline rendering.
 *
 * Todos format: `[{ content: string, status: "pending" | "in_progress" | "completed" }]`
 */
export function parsePlanStepsFromTodos(todos: unknown): PlanStep[] {
  if (!Array.isArray(todos)) return [];
  return todos.map((t: any, idx: number) => ({
    id: t.id || `todo-${idx}`,
    agent: t.agent || "Supervisor",
    description: t.content || t.description || t.title || "",
    status: normalizePlanStatus(t.status || "pending"),
  }));
}

// ─── Tool Parsing ────────────────────────────────────────────────────────────

/**
 * Extract tool info from an A2A artifact (tool_notification_start/end).
 */
export function parseToolFromArtifact(artifact: Artifact): {
  agent: string;
  tool: string;
  planStepId?: string;
} | null {
  if (!artifact) return null;

  const description = artifact.description || "";
  const metadata = artifact.metadata || {};

  let tool = "Unknown Tool";
  const descMatch = description.match(/Tool call (?:started|completed):\s*(.+)/i);
  if (descMatch) {
    tool = descMatch[1].trim();
  }

  const agent = (metadata.sourceAgent as string) || "Agent";
  const planStepId = metadata.plan_step_id as string | undefined;

  return { agent, tool, planStepId };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function normalizePlanStatus(status: string): PlanStep["status"] {
  const s = status?.toLowerCase();
  if (s === "completed" || s === "complete") return "completed";
  if (s === "in_progress") return "in_progress";
  if (s === "input_required") return "input_required";
  if (s === "failed" || s === "error") return "failed";
  return "pending";
}
