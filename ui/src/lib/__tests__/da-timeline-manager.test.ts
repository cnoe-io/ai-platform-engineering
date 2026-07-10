import { createTimelineManager } from "@/lib/da-timeline-manager";
import type { SubagentSegment } from "@/types/dynamic-agent-timeline";

function getSubagent(manager: ReturnType<typeof createTimelineManager>): SubagentSegment {
  const segment = manager.getGroupedData().segments.find((item) => item.type === "subagent");
  expect(segment?.type).toBe("subagent");
  return segment as SubagentSegment;
}

describe("TimelineManager resumed subagents", () => {
  it("renders buffered subagent content immediately while streaming", () => {
    const manager = createTimelineManager();
    manager.pushToolStart(
      {
        tool_name: "task",
        tool_call_id: "task-1",
        args: { subagent_type: "agent-test-2", description: "Collect fruit" },
      },
      [],
    );

    manager.pushContent("The child is still working", ["task-1"]);

    const subagent = getSubagent(manager);
    expect(subagent.info).toMatchObject({
      id: "task-1",
      agentId: "agent-test-2",
      status: "running",
    });
    expect(subagent.segments).toContainEqual(
      expect.objectContaining({ type: "content", text: "The child is still working" }),
    );
  });

  it("creates a placeholder instead of dropping resume-only namespaced content", () => {
    const manager = createTimelineManager();

    manager.pushContent("Resumed child output", ["task-from-checkpoint"]);

    expect(getSubagent(manager)).toMatchObject({
      info: { id: "task-from-checkpoint", name: "subagent", status: "running" },
      segments: [expect.objectContaining({ type: "content", text: "Resumed child output" })],
    });

    manager.pushToolEnd("task-from-checkpoint", []);

    expect(getSubagent(manager).info.status).toBe("completed");
  });
});
