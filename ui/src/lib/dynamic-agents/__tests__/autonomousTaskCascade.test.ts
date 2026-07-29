// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for the dynamic-agent <-> autonomous-task cascade helpers.
 *
 * Covers two distinct cascades that keep the autonomous-agents service in
 * sync with dynamic-agent lifecycle events:
 *   - cascadeDeleteAutonomousTasksForAgent: agent deleted -> its tasks are
 *     hard-deleted (fail-fast: any failure must surface so the caller can
 *     abort the agent deletion rather than leave an orphaned, still-live
 *     task behind).
 *   - cascadePauseAutonomousTasksForAgents: a team's automator/eligibility
 *     grant on one or more agents is revoked -> those agents' enabled tasks
 *     are flipped to disabled (fail-open: a failure to pause one task must
 *     not stop the rest, and must not throw -- the caller treats this as
 *     best-effort cleanup, not a security boundary).
 */

let mockAutonomousAgentsEnabled = true;

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => {
    if (key === "autonomousAgentsEnabled") return mockAutonomousAgentsEnabled;
    return undefined;
  },
}));

const mockFetch = jest.fn();
beforeAll(() => {
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

import {
  cascadeDeleteAutonomousTasksForAgent,
  cascadePauseAutonomousTasksForAgents,
} from "../autonomousTaskCascade";
import type { AutonomousTask } from "@/components/autonomous/types";

function task(overrides: Partial<AutonomousTask>): AutonomousTask {
  return {
    id: "task-1",
    name: "Task",
    agent: null,
    dynamic_agent_id: null,
    prompt: "do the thing",
    trigger: { type: "cron", schedule: "0 9 * * *" },
    enabled: true,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAutonomousAgentsEnabled = true;
  delete process.env.AUTONOMOUS_AGENTS_URL;
  delete process.env.NEXT_PUBLIC_AUTONOMOUS_AGENTS_URL;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("cascadeDeleteAutonomousTasksForAgent", () => {
  it("no-ops without calling fetch when autonomous agents are disabled", async () => {
    mockAutonomousAgentsEnabled = false;
    const result = await cascadeDeleteAutonomousTasksForAgent("agent-a");
    expect(result).toEqual({ attempted: 0, deleted: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("deletes only tasks matching dynamic_agent_id or legacy agent field", async () => {
    const tasks = [
      task({ id: "t1", dynamic_agent_id: "agent-a" }),
      task({ id: "t2", agent: "agent-a", dynamic_agent_id: null }),
      task({ id: "t3", dynamic_agent_id: "agent-b" }),
    ];
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, tasks)) // GET /tasks
      .mockResolvedValueOnce(jsonResponse(204, null)) // DELETE t1
      .mockResolvedValueOnce(jsonResponse(204, null)); // DELETE t2

    const result = await cascadeDeleteAutonomousTasksForAgent("agent-a");

    expect(result).toEqual({ attempted: 2, deleted: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8002/api/v1/tasks",
      expect.objectContaining({ headers: expect.not.objectContaining({ "X-Authenticated-User-Email": expect.anything() }) }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2, "http://localhost:8002/api/v1/tasks/t1", expect.objectContaining({ method: "DELETE" }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, "http://localhost:8002/api/v1/tasks/t2", expect.objectContaining({ method: "DELETE" }));
  });

  it("treats a 404 on an individual delete as already-gone success", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, [task({ id: "t1", dynamic_agent_id: "agent-a" })]))
      .mockResolvedValueOnce(jsonResponse(404, { detail: "not found" }));

    const result = await cascadeDeleteAutonomousTasksForAgent("agent-a");
    expect(result).toEqual({ attempted: 1, deleted: 1 });
  });

  it("throws when the list call fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { detail: "boom" }));
    await expect(cascadeDeleteAutonomousTasksForAgent("agent-a")).rejects.toThrow();
  });

  it("throws when the list call rejects with a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(cascadeDeleteAutonomousTasksForAgent("agent-a")).rejects.toThrow();
  });

  it("throws on a non-404 delete failure without swallowing it", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, [task({ id: "t1", dynamic_agent_id: "agent-a" })]))
      .mockResolvedValueOnce(jsonResponse(500, { detail: "boom" }));

    await expect(cascadeDeleteAutonomousTasksForAgent("agent-a")).rejects.toThrow();
  });

  it("returns zero attempted/deleted when nothing matches", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, [task({ id: "t1", dynamic_agent_id: "agent-other" })]));
    const result = await cascadeDeleteAutonomousTasksForAgent("agent-a");
    expect(result).toEqual({ attempted: 0, deleted: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("cascadePauseAutonomousTasksForAgents", () => {
  it("no-ops without calling fetch when autonomous agents are disabled", async () => {
    mockAutonomousAgentsEnabled = false;
    const result = await cascadePauseAutonomousTasksForAgents(["agent-a"]);
    expect(result).toEqual({ attempted: 0, paused: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("pauses only currently-enabled tasks across multiple agent ids, leaving other fields intact", async () => {
    const already_disabled = task({ id: "t2", dynamic_agent_id: "agent-b", enabled: false });
    const enabled_a = task({ id: "t1", dynamic_agent_id: "agent-a", enabled: true, prompt: "keep me" });
    const not_matching = task({ id: "t3", dynamic_agent_id: "agent-other", enabled: true });
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, [enabled_a, already_disabled, not_matching]))
      .mockResolvedValueOnce(jsonResponse(200, { ...enabled_a, enabled: false }));

    const result = await cascadePauseAutonomousTasksForAgents(["agent-a", "agent-b"]);

    expect(result).toEqual({ attempted: 1, paused: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8002/api/v1/tasks/t1",
      expect.objectContaining({ method: "PUT" }),
    );
    const putCall = mockFetch.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(putCall.body as string);
    expect(body).toMatchObject({ id: "t1", prompt: "keep me", enabled: false });
  });

  it("logs and continues past a failing PUT instead of throwing", async () => {
    const t1 = task({ id: "t1", dynamic_agent_id: "agent-a", enabled: true });
    const t2 = task({ id: "t2", dynamic_agent_id: "agent-a", enabled: true });
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, [t1, t2]))
      .mockResolvedValueOnce(jsonResponse(500, { detail: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, { ...t2, enabled: false }));

    const result = await cascadePauseAutonomousTasksForAgents(["agent-a"]);
    expect(result).toEqual({ attempted: 2, paused: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("logs and continues past a network error on an individual PUT", async () => {
    const t1 = task({ id: "t1", dynamic_agent_id: "agent-a", enabled: true });
    const t2 = task({ id: "t2", dynamic_agent_id: "agent-a", enabled: true });
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, [t1, t2]))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse(200, { ...t2, enabled: false }));

    const result = await cascadePauseAutonomousTasksForAgents(["agent-a"]);
    expect(result).toEqual({ attempted: 2, paused: 1 });
  });

  it("propagates a list-call failure to the caller", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { detail: "boom" }));
    await expect(cascadePauseAutonomousTasksForAgents(["agent-a"])).rejects.toThrow();
  });

  it("returns zero attempted/paused when nothing matches", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, [task({ id: "t1", dynamic_agent_id: "agent-other" })]));
    const result = await cascadePauseAutonomousTasksForAgents(["agent-a"]);
    expect(result).toEqual({ attempted: 0, paused: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
