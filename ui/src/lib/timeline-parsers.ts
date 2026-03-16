/**
 * Shared parsing helpers for A2A timeline events.
 *
 * Used by ChatPanel (streaming loop) and TimelineManager.
 * Parses structured DataPart plans emitted by the backend.
 */

import type { PlanStep, Artifact } from "@/types/a2a";

// ─── Plan Step Parsing ───────────────────────────────────────────────────────

interface DataPartStep {
  step_id: string;
  title: string;
  agent: string;
  status: string;
  order: number;
}

interface PlanData {
  steps?: DataPartStep[];
}

/**
 * Parse plan steps from a structured DataPart.
 * Returns empty array if data doesn't contain valid plan steps.
 */
export function parsePlanStepsFromData(data: unknown): PlanStep[] {
  if (!data || typeof data !== "object") return [];
  const planData = data as PlanData;
  if (!Array.isArray(planData.steps)) return [];

  return planData.steps.map((s) => ({
    id: s.step_id || `step-${s.order}`,
    agent: s.agent || "Supervisor",
    description: s.title || "",
    status: normalizePlanStatus(s.status),
  }));
}

// ─── Tool Parsing ────────────────────────────────────────────────────────────

/**
 * Extract tool info from an artifact (tool_notification_start/end).
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
