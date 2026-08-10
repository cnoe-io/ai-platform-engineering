// assisted-by Codex Codex-sonnet-4-6
//
// Workflow-scoped delegation: a workflow may grant agent-use to the user
// who started it, for the duration of that run. This prevents DA from
// needing to read workflow_configs or teams from MongoDB.
//
// Currently a stub — wired at POST /api/workflow-runs in a future PR.

import type { AuthorizeRequest, AuthorizeResult } from "../contract";

export interface WorkflowRunContext {
  workflowRunId: string;
  /** Agent ids the workflow delegates can_use to the run owner. */
  delegatedAgentIds: Set<string>;
  /** The subject who started the run. */
  ownerSubjectId: string;
}

/** In-memory run registry. Populated by POST /api/workflow-runs. */
const activeRuns = new Map<string, WorkflowRunContext>();

export function registerWorkflowRun(ctx: WorkflowRunContext): void {
  activeRuns.set(ctx.workflowRunId, ctx);
}

export function unregisterWorkflowRun(workflowRunId: string): void {
  activeRuns.delete(workflowRunId);
}

/**
 * Returns ALLOW if the request is for an agent the active workflow run
 * has delegated to the caller. Returns null otherwise (fall through to PDP).
 */
export function workflowDelegationPreCheck(
  req: AuthorizeRequest,
): AuthorizeResult | null {
  if (req.resource.type !== "agent" || req.action !== "use") return null;

  const runId = req.trustedContext?.workflowRunId;
  if (typeof runId !== "string") return null;

  const run = activeRuns.get(runId);
  if (!run) return null;
  if (run.ownerSubjectId !== req.subject.id) return null;
  if (!run.delegatedAgentIds.has(req.resource.id)) return null;

  return { decision: "ALLOW", reason: "OK", retriable: false, via: "workflow_delegation" };
}
