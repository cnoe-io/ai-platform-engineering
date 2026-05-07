// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Diff-and-dispatch helper that reconciles the Autonomous tab's draft
 * task list with what's already persisted for a given custom agent.
 *
 * Called from ``DynamicAgentEditor.handleSubmit`` after the agent
 * create/update succeeds: the editor owns the agent slug at that point
 * and can stamp it onto every task (``task.agent = agentId``) before
 * the writes hit the autonomous-agents service.
 *
 * Pure over the injected ``api`` so it can be unit-tested without
 * network.
 */

import type { AutonomousTask } from "@/components/autonomous/types";

export type SyncOpType = "create" | "update" | "delete";

export interface SyncResultEntry {
  op: SyncOpType;
  taskId: string;
  ok: boolean;
  error?: string;
}

export interface AutonomousTasksApi {
  createTask: (task: AutonomousTask) => Promise<AutonomousTask>;
  updateTask: (id: string, task: AutonomousTask) => Promise<AutonomousTask>;
  deleteTask: (id: string) => Promise<void>;
}

/**
 * Shallow equality check scoped to the fields ``AutonomousTasksStep``
 * can mutate. We compare on trigger separately (serialized) because
 * its shape varies by type. We intentionally IGNORE ``last_ack`` and
 * ``next_run`` / ``chat_conversation_id`` — those are server-owned and
 * the UI never edits them.
 */
function tasksEqual(a: AutonomousTask, b: AutonomousTask): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if ((a.description ?? null) !== (b.description ?? null)) return false;
  if ((a.agent ?? null) !== (b.agent ?? null)) return false;
  // dynamic_agent_id is the routing target for custom agent tasks
  // and changing it changes which backend (supervisor vs dynamic-
  // agents service) receives the prompt -- definitely a diff.
  if ((a.dynamic_agent_id ?? null) !== (b.dynamic_agent_id ?? null)) return false;
  if (a.prompt !== b.prompt) return false;
  if ((a.llm_provider ?? null) !== (b.llm_provider ?? null)) return false;
  if (a.enabled !== b.enabled) return false;
  if ((a.timeout_seconds ?? null) !== (b.timeout_seconds ?? null)) return false;
  if ((a.max_retries ?? null) !== (b.max_retries ?? null)) return false;

  // Serialize triggers for comparison. Webhook secrets are treated
  // specially: when the draft secret is empty/undefined we are saying
  // "keep whatever is on the server", so don't treat that as a diff
  // just because the server-side view omits the raw secret.
  const triggerDraft = normalizeTriggerForDiff(a.trigger);
  const triggerServer = normalizeTriggerForDiff(b.trigger);
  return JSON.stringify(triggerDraft) === JSON.stringify(triggerServer);
}

function normalizeTriggerForDiff(trigger: AutonomousTask["trigger"]): unknown {
  if (trigger.type === "webhook") {
    // Drop server-only has_secret and any empty/null secret so that
    // "user typed nothing" doesn't look like "clear the secret".
    const secret = trigger.secret;
    return {
      type: "webhook",
      provider: trigger.provider ?? "github",
      secret: secret && secret.length > 0 ? secret : undefined,
    };
  }
  return trigger;
}

export interface SyncInput {
  agentId: string;
  drafts: AutonomousTask[];
  serverTasks: AutonomousTask[];
  api: AutonomousTasksApi;
}

/**
 * Reconcile drafts against server-state. Creates drafts not present
 * on the server, updates drafts whose fields differ, and deletes
 * server tasks missing from the draft list.
 *
 * Each draft is stamped with ``dynamic_agent_id: agentId`` before
 * dispatch (and ``agent`` is cleared) so the autonomous-agents
 * service routes the task through the dynamic-agents service
 * instead of the supervisor. Without this, the supervisor's
 * preflight would always fail (it has no awareness of dynamic-
 * agent ids) and the task body would be silently answered by the
 * supervisor's own LLM rather than the user's custom agent.
 *
 * A per-entry result list is always returned — failures are
 * captured, never thrown — so the caller can surface partial success
 * (e.g. 2 of 3 created, 1 failed).
 */
export async function syncAutonomousTasks({
  agentId,
  drafts,
  serverTasks,
  api,
}: SyncInput): Promise<SyncResultEntry[]> {
  const results: SyncResultEntry[] = [];

  const serverById = new Map(serverTasks.map((t) => [t.id, t]));
  const draftIds = new Set(drafts.map((d) => d.id));

  // Creates + updates
  for (const draft of drafts) {
    const stamped: AutonomousTask = {
      ...draft,
      dynamic_agent_id: agentId,
      agent: null,
    };
    const existing = serverById.get(draft.id);
    if (!existing) {
      try {
        await api.createTask(stamped);
        results.push({ op: "create", taskId: stamped.id, ok: true });
      } catch (err) {
        results.push({
          op: "create",
          taskId: stamped.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    if (!tasksEqual(stamped, existing)) {
      try {
        await api.updateTask(stamped.id, stamped);
        results.push({ op: "update", taskId: stamped.id, ok: true });
      } catch (err) {
        results.push({
          op: "update",
          taskId: stamped.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Deletes
  for (const server of serverTasks) {
    if (draftIds.has(server.id)) continue;
    try {
      await api.deleteTask(server.id);
      results.push({ op: "delete", taskId: server.id, ok: true });
    } catch (err) {
      results.push({
        op: "delete",
        taskId: server.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
