// assisted-by claude code claude-sonnet-4-6
// OpenFGA reconciliation for individual workflow runs (stored as `task:<run-id>`).
// Mirrors reconcileWorkflowConfigAccess but scoped to a single run,
// allowing run-level team-sharing independent of config visibility.

import type { OpenFgaReconcileResult } from "./openfga";
import { reconcileShareableResource } from "./openfga-owned-resources-reconcile";
import { buildTeamRefToSlugMap, resolveSharedTeamSlugs } from "./workflow-config-rebac";

export interface WorkflowRunRebacInput {
  _id: string;
  owner_subject?: { id?: string | null; type?: string | null } | null;
}

/**
 * Sync FGA tuples for a workflow run's team-share grants.
 * Uses the same `task` FGA object type as configs, but keyed on `run._id`
 * so config and run grants are independent and separately auditable.
 *
 * Call on every share update, passing the full next/previous slug lists
 * so the reconciler can diff and emit only the changed tuples.
 */
export async function reconcileWorkflowRunAccess(
  run: WorkflowRunRebacInput,
  nextSharedTeamSlugs: string[],
  previousSharedTeamSlugs: string[],
): Promise<OpenFgaReconcileResult> {
  const ownerSubject = run.owner_subject?.id ?? null;
  const ownerSubjectKind =
    run.owner_subject?.type === "service_account" ? "service_account" : "user";

  const teamRefToSlug =
    nextSharedTeamSlugs.length > 0 || previousSharedTeamSlugs.length > 0
      ? await buildTeamRefToSlugMap()
      : undefined;

  return reconcileShareableResource({
    objectType: "task",
    objectId: run._id,
    ownerSubject,
    ownerSubjectKind,
    creatorSubject: ownerSubject,
    memberRelations: ["reader", "user"],
    nextSharedTeamSlugs: resolveSharedTeamSlugs(nextSharedTeamSlugs, teamRefToSlug),
    previousSharedTeamSlugs: resolveSharedTeamSlugs(previousSharedTeamSlugs, teamRefToSlug),
  });
}
