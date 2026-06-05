/**
 * Shared workflow run access helpers (list, poll, resume, cancel).
 */

import { getCollection } from "@/lib/mongodb";
import { ApiError } from "@/lib/api-error";
import type { ResourceAuthzSession } from "./resource-authz";
import {
  canViewWorkflowRunsForConfig,
  requireWorkflowConfigRunAccess,
  requireWorkflowConfigRunViewAccess,
  resolveUserTeamSlugsForWorkflow,
  type WorkflowConfigRebacSnapshot,
} from "./workflow-config-rebac";
import type { WorkflowConfig } from "@/types/workflow-config";

export function workflowConfigAccessSnapshot(
  config: Pick<
    WorkflowConfig,
    "_id" | "owner_id" | "visibility" | "shared_with_teams" | "config_driven"
  >,
): WorkflowConfigRebacSnapshot {
  return {
    _id: String(config._id),
    owner_id: config.owner_id,
    visibility: config.visibility,
    shared_with_teams: config.shared_with_teams,
    config_driven: config.config_driven,
  };
}

export async function loadWorkflowConfigForRunAccess(
  configId: string,
): Promise<WorkflowConfig | null> {
  const configCol = await getCollection<WorkflowConfig>("workflow_configs");
  return configCol.findOne({ _id: configId as WorkflowConfig["_id"] });
}

export async function assertCanViewWorkflowRunsForConfigId(
  session: ResourceAuthzSession,
  configId: string,
  userEmail: string,
  userTeamSlugs?: string[],
): Promise<WorkflowConfig> {
  const config = await loadWorkflowConfigForRunAccess(configId);
  if (!config) {
    throw new ApiError(`Workflow config ${configId} not found`, 404);
  }
  await requireWorkflowConfigRunViewAccess(
    session,
    workflowConfigAccessSnapshot(config),
    userEmail,
    userTeamSlugs,
  );
  return config;
}

export async function assertCanExecuteWorkflowRunsForConfigId(
  session: ResourceAuthzSession,
  configId: string,
  userEmail: string,
  userTeamSlugs?: string[],
): Promise<WorkflowConfig> {
  const config = await loadWorkflowConfigForRunAccess(configId);
  if (!config) {
    throw new ApiError(`Workflow config ${configId} not found`, 404);
  }
  await requireWorkflowConfigRunAccess(
    session,
    workflowConfigAccessSnapshot(config),
    userEmail,
    userTeamSlugs,
  );
  return config;
}

export async function canViewWorkflowRunsForConfigId(
  session: ResourceAuthzSession,
  configId: string,
  userEmail: string,
  userTeamSlugs?: string[],
): Promise<boolean> {
  const config = await loadWorkflowConfigForRunAccess(configId);
  if (!config) {
    return false;
  }
  return canViewWorkflowRunsForConfig(
    session,
    workflowConfigAccessSnapshot(config),
    userEmail,
    userTeamSlugs,
  );
}
