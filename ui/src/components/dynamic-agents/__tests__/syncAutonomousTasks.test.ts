// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

import type { AutonomousTask } from "@/components/autonomous/types";
import {
  syncAutonomousTasks,
  type AutonomousTasksApi,
} from "../syncAutonomousTasks";

// All fixtures are pre-stamped with the new dynamic-agent routing
// convention (``dynamic_agent_id: "my_agent"``, ``agent: null``) so
// "no diff" tests don't accidentally fail on the routing-field change
// rather than the field they're actually exercising.
function cronTask(id: string, overrides: Partial<AutonomousTask> = {}): AutonomousTask {
  return {
    id,
    name: `Task ${id}`,
    description: null,
    agent: null,
    dynamic_agent_id: "my_agent",
    prompt: "hello",
    llm_provider: null,
    trigger: { type: "cron", schedule: "0 9 * * *" },
    enabled: true,
    timeout_seconds: null,
    max_retries: null,
    ...overrides,
  };
}

function makeApi(): jest.Mocked<AutonomousTasksApi> {
  return {
    createTask: jest.fn().mockImplementation(async (t: AutonomousTask) => t),
    updateTask: jest.fn().mockImplementation(async (_id: string, t: AutonomousTask) => t),
    deleteTask: jest.fn().mockResolvedValue(undefined),
  };
}

describe("syncAutonomousTasks", () => {
  it("stamps dynamic_agent_id onto created tasks and clears agent", async () => {
    // Drafts come out of the editor with both routing fields blank --
    // syncAutonomousTasks is the seam that decides this is a custom-
    // agent task and stamps ``dynamic_agent_id`` (not ``agent``) so
    // the autonomous-agents service routes the run through the
    // dynamic-agents path rather than the supervisor.
    const api = makeApi();
    const draft = cronTask("t1", { agent: null, dynamic_agent_id: null });

    const results = await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [draft],
      serverTasks: [],
      api,
    });

    expect(api.createTask).toHaveBeenCalledTimes(1);
    const submitted = api.createTask.mock.calls[0][0];
    expect(submitted.dynamic_agent_id).toBe("my_agent");
    expect(submitted.agent).toBeNull();
    expect(results).toEqual([{ op: "create", taskId: "t1", ok: true }]);
  });

  it("clears a legacy agent hint when stamping dynamic_agent_id", async () => {
    // Backfill scenario: a task created before this change still has
    // ``agent: <dynamic-agent-id>`` from the old stamping. Re-saving
    // the agent must migrate it to ``dynamic_agent_id`` AND null out
    // ``agent`` so the supervisor branch can never fire on it again.
    const api = makeApi();
    const draft = cronTask("t1", {
      agent: "my_agent",
      dynamic_agent_id: null,
    });

    await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [draft],
      serverTasks: [],
      api,
    });

    const submitted = api.createTask.mock.calls[0][0];
    expect(submitted.dynamic_agent_id).toBe("my_agent");
    expect(submitted.agent).toBeNull();
  });

  it("updates tasks whose editable fields changed", async () => {
    const api = makeApi();
    const server = cronTask("t1", { prompt: "old" });
    const draft = cronTask("t1", { prompt: "new" });

    const results = await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [draft],
      serverTasks: [server],
      api,
    });

    expect(api.updateTask).toHaveBeenCalledTimes(1);
    expect(api.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        prompt: "new",
        dynamic_agent_id: "my_agent",
        agent: null,
      }),
    );
    expect(results).toEqual([{ op: "update", taskId: "t1", ok: true }]);
  });

  it("skips updates when nothing changed", async () => {
    const api = makeApi();
    const task = cronTask("t1");

    const results = await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [task],
      serverTasks: [task],
      api,
    });

    expect(api.createTask).not.toHaveBeenCalled();
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("deletes server tasks not present in drafts", async () => {
    const api = makeApi();
    const server1 = cronTask("keep");
    const server2 = cronTask("drop");

    const results = await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [server1],
      serverTasks: [server1, server2],
      api,
    });

    expect(api.deleteTask).toHaveBeenCalledWith("drop");
    expect(api.deleteTask).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ op: "delete", taskId: "drop", ok: true }]);
  });

  it("handles mixed create/update/delete in one pass", async () => {
    const api = makeApi();
    const existingUnchanged = cronTask("unchanged");
    const existingChanged = cronTask("changed", { enabled: true });
    const draftChanged = cronTask("changed", { enabled: false });
    const newDraft = cronTask("brand_new");
    const droppedServer = cronTask("dropped");

    const results = await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [existingUnchanged, draftChanged, newDraft],
      serverTasks: [existingUnchanged, existingChanged, droppedServer],
      api,
    });

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "brand_new" }),
    );
    expect(api.updateTask).toHaveBeenCalledWith(
      "changed",
      expect.objectContaining({ enabled: false }),
    );
    expect(api.deleteTask).toHaveBeenCalledWith("dropped");

    expect(results).toEqual(
      expect.arrayContaining([
        { op: "create", taskId: "brand_new", ok: true },
        { op: "update", taskId: "changed", ok: true },
        { op: "delete", taskId: "dropped", ok: true },
      ]),
    );
    expect(results).toHaveLength(3);
  });

  it("re-syncs when dynamic_agent_id changes (re-targeting)", async () => {
    // Sanity: changing the dynamic_agent_id (e.g. re-pointing an
    // autonomous task at a different custom agent) must trigger an
    // update -- otherwise the routing target on the server would
    // silently drift behind the editor.
    const api = makeApi();
    const server = cronTask("t1", { dynamic_agent_id: "old_agent" });
    const draft = cronTask("t1", { dynamic_agent_id: "old_agent" });

    await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [draft],
      serverTasks: [server],
      api,
    });

    expect(api.updateTask).toHaveBeenCalledTimes(1);
    expect(api.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ dynamic_agent_id: "my_agent" }),
    );
  });

  it("captures per-operation failures without throwing", async () => {
    const api = makeApi();
    api.createTask.mockRejectedValueOnce(new Error("boom"));

    const results = await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [cronTask("bad")],
      serverTasks: [],
      api,
    });

    expect(results).toEqual([
      { op: "create", taskId: "bad", ok: false, error: "boom" },
    ]);
  });

  it("treats webhook drafts with blank secret as equal to existing has_secret task", async () => {
    const api = makeApi();
    const serverWebhook: AutonomousTask = {
      ...cronTask("hook"),
      trigger: { type: "webhook", provider: "github", has_secret: true },
    };
    const draftWebhook: AutonomousTask = {
      ...cronTask("hook"),
      trigger: { type: "webhook", provider: "github", secret: null },
    };

    await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [draftWebhook],
      serverTasks: [serverWebhook],
      api,
    });

    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("updates webhook task when provider changes", async () => {
    const api = makeApi();
    const serverWebhook: AutonomousTask = {
      ...cronTask("hook"),
      trigger: { type: "webhook", provider: "github", has_secret: true },
    };
    const draftWebhook: AutonomousTask = {
      ...cronTask("hook"),
      trigger: { type: "webhook", provider: "jira", secret: null },
    };

    await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [draftWebhook],
      serverTasks: [serverWebhook],
      api,
    });

    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });

  it("updates webhook task when a new secret is typed", async () => {
    const api = makeApi();
    const serverWebhook: AutonomousTask = {
      ...cronTask("hook"),
      trigger: { type: "webhook", has_secret: false },
    };
    const draftWebhook: AutonomousTask = {
      ...cronTask("hook"),
      trigger: { type: "webhook", secret: "rotate-me" },
    };

    await syncAutonomousTasks({
      agentId: "my_agent",
      drafts: [draftWebhook],
      serverTasks: [serverWebhook],
      api,
    });

    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });
});
