import { ApiError } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import type { WorkflowConfig, WorkflowStep } from "@/types/workflow-config";

/**
 * Fail fast when a workflow references dynamic agent IDs that are not in MongoDB.
 */
export async function assertWorkflowStepAgentsExist(config: WorkflowConfig): Promise<void> {
  const agentIds = [
    ...new Set(
      (config.steps ?? [])
        .filter((entry): entry is WorkflowStep => entry.type === "step")
        .map((step) => step.agent_id)
        .filter((id): id is string => Boolean(id?.trim())),
    ),
  ];

  if (agentIds.length === 0) {
    return;
  }

  const agentCol = await getCollection<{ _id: string }>("dynamic_agents");
  const found = await agentCol
    .find({ _id: { $in: agentIds } })
    .project({ _id: 1 })
    .toArray();
  const foundIds = new Set(found.map((doc) => String(doc._id)));
  const missing = agentIds.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {
    throw new ApiError(
      `This workflow references agent(s) that do not exist: ${missing.join(", ")}. ` +
        "Open the workflow in the editor, select each step, and choose an agent from the catalog " +
        "(or update config/app-config.yaml for config-driven workflows and restart the UI).",
      400,
    );
  }
}
