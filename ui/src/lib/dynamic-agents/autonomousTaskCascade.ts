// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Keeps the autonomous-agents service in sync with dynamic-agent lifecycle
 * events that would otherwise orphan autonomous tasks:
 *
 *   - An agent is deleted: its tasks must be hard-deleted too, otherwise a
 *     later agent recreated with the same (deterministic, name-derived) id
 *     silently re-adopts the orphaned, still-scheduled task.
 *   - A team's automator/eligibility grant on an agent is revoked: the
 *     agent's tasks keep firing and failing forever with no visible
 *     "paused" state (autonomous authz is enforced per-run, not by
 *     disabling the task), so they're flipped to `enabled: false` instead.
 *
 * Calls the autonomous-agents service directly, the same way
 * `ui/src/app/api/autonomous/oversight/route.ts` does: no
 * `X-Authenticated-User-*` headers, which the service treats as a trusted
 * "direct service call without gateway" and answers with the full
 * unfiltered task list / unconditional per-task access (see
 * `_get_caller` / `_assert_task_access` in
 * `autonomous_agents/routes/tasks.py`).
 */

import { getConfig } from "@/lib/config";
import { isTaskOwnedByAgent } from "@/components/dynamic-agents/taskOwnership";
import type { AutonomousTask } from "@/components/autonomous/types";

function autonomousAgentsBaseUrl(): string {
  return (
    process.env.AUTONOMOUS_AGENTS_URL ||
    process.env.NEXT_PUBLIC_AUTONOMOUS_AGENTS_URL ||
    "http://localhost:8002"
  ).replace(/\/$/, "");
}

async function fetchTasksForAgentIds(agentIds: Set<string>): Promise<AutonomousTask[]> {
  if (!getConfig("autonomousAgentsEnabled") || agentIds.size === 0) return [];

  const res = await fetch(`${autonomousAgentsBaseUrl()}/api/v1/tasks`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Autonomous-agents service returned ${res.status} while listing tasks`);
  }
  const tasks: AutonomousTask[] = await res.json();
  return tasks.filter((t) => {
    for (const agentId of agentIds) {
      if (isTaskOwnedByAgent(t, agentId)) return true;
    }
    return false;
  });
}

export interface CascadeDeleteResult {
  attempted: number;
  deleted: number;
}

/**
 * Delete every autonomous task owned by `agentId`. Fail-fast: any failure
 * (network error, non-2xx/404 response) throws immediately so the caller
 * can abort the agent deletion rather than leave a partially-cleaned,
 * ambiguous state. A 404 on an individual task delete means it's already
 * gone (a benign race), not an error.
 */
export async function cascadeDeleteAutonomousTasksForAgent(
  agentId: string,
): Promise<CascadeDeleteResult> {
  const tasks = await fetchTasksForAgentIds(new Set([agentId]));

  let deleted = 0;
  for (const task of tasks) {
    const res = await fetch(`${autonomousAgentsBaseUrl()}/api/v1/tasks/${task.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Autonomous-agents service returned ${res.status} while deleting task ${task.id}`,
      );
    }
    deleted++;
  }
  return { attempted: tasks.length, deleted };
}

export interface CascadePauseResult {
  attempted: number;
  paused: number;
}

/**
 * Pause (`enabled: false`) every currently-enabled autonomous task owned by
 * any of `agentIds`. Fail-open per task: a failed pause is logged and
 * skipped so the rest of the batch still gets attempted. This is
 * best-effort cleanup, not a security boundary -- the live per-run authz
 * check in the dynamic-agents service already blocks execution regardless
 * of whether the task's `enabled` flag gets flipped. A list-call failure
 * still propagates, since without the list there's nothing to attempt.
 */
export async function cascadePauseAutonomousTasksForAgents(
  agentIds: string[],
): Promise<CascadePauseResult> {
  const tasks = await fetchTasksForAgentIds(new Set(agentIds));
  const enabledTasks = tasks.filter((t) => t.enabled);

  let paused = 0;
  for (const task of enabledTasks) {
    try {
      const res = await fetch(`${autonomousAgentsBaseUrl()}/api/v1/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...task, enabled: false }),
      });
      if (res.ok) {
        paused++;
      } else {
        console.warn(
          `[autonomous-task-cascade] pause failed for task ${task.id}: HTTP ${res.status}`,
        );
      }
    } catch (err) {
      console.warn(`[autonomous-task-cascade] pause failed for task ${task.id}:`, err);
    }
  }
  return { attempted: enabledTasks.length, paused };
}
