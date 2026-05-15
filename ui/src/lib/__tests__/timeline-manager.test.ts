/**
 * Tests for SupervisorTimelineManager — verifies plan merge logic,
 * thinking routing, and final answer handling.
 */

import { SupervisorTimelineManager } from "../timeline-manager";
import type { PlanStep } from "@/types/a2a";
import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/core";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStep(
  id: string,
  title: string,
  status: PlanStep["status"] = "pending",
  agent = "RAG",
): PlanStep {
  return { id, agent, description: title, status };
}

// ─── pushPlan merge scenarios ───────────────────────────────────────────────

describe("SupervisorTimelineManager.pushPlan", () => {
  it("creates a new plan from the initial execution_plan_update", () => {
    const tm = new SupervisorTimelineManager();
    const steps = [
      makeStep("s1", "Search SCS docs", "in_progress"),
      makeStep("s2", "Search networking", "pending"),
      makeStep("s3", "Find DNS examples", "pending"),
    ];

    tm.pushPlan(steps, 1);

    const segs = tm.getSegments();
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("execution_plan");
    expect(segs[0].planSteps).toHaveLength(3);
    expect(segs[0].planSteps![0].status).toBe("in_progress");
  });

  it("merges a single-step status update into the existing plan", () => {
    const tm = new SupervisorTimelineManager();
    // Initial plan: 3 steps
    tm.pushPlan(
      [
        makeStep("s1", "Search SCS docs", "in_progress"),
        makeStep("s2", "Search networking", "pending"),
        makeStep("s3", "Find DNS examples", "pending"),
      ],
      1,
    );

    // Status update: only step s1 completed
    tm.pushPlan([makeStep("s1", "Search SCS docs", "completed")], 2);

    const steps = tm.getSegments()[0].planSteps!;
    expect(steps).toHaveLength(3); // All 3 steps preserved
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("pending");
    expect(steps[2].status).toBe("pending");
  });

  it("merges a full-plan status update (all steps present)", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushPlan(
      [
        makeStep("s1", "Step 1", "in_progress"),
        makeStep("s2", "Step 2", "pending"),
        makeStep("s3", "Step 3", "pending"),
      ],
      1,
    );

    // Full update with all steps — s1 completed, s2 in_progress
    tm.pushPlan(
      [
        makeStep("s1", "Step 1", "completed"),
        makeStep("s2", "Step 2", "in_progress"),
        makeStep("s3", "Step 3", "pending"),
      ],
      2,
    );

    const steps = tm.getSegments()[0].planSteps!;
    expect(steps).toHaveLength(3);
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("in_progress");
    expect(steps[2].status).toBe("pending");
  });

  it("appends a new step when the LLM adds to the plan", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushPlan(
      [
        makeStep("s1", "Step 1", "completed"),
        makeStep("s2", "Step 2", "in_progress"),
      ],
      1,
    );

    // LLM adds s3 in the status update along with s2 completed
    tm.pushPlan(
      [
        makeStep("s2", "Step 2", "completed"),
        makeStep("s3", "New step added", "in_progress"),
      ],
      2,
    );

    const steps = tm.getSegments()[0].planSteps!;
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ id: "s1", status: "completed" });
    expect(steps[1]).toMatchObject({ id: "s2", status: "completed" });
    expect(steps[2]).toMatchObject({ id: "s3", description: "New step added", status: "in_progress" });
  });

  it("tracks currentPlanStepId from merged plan, not just incoming steps", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushPlan(
      [
        makeStep("s1", "Step 1", "in_progress"),
        makeStep("s2", "Step 2", "pending"),
        makeStep("s3", "Step 3", "pending"),
      ],
      1,
    );

    // Status update marks s1 completed but doesn't include s2/s3
    tm.pushPlan([makeStep("s1", "Step 1", "completed")], 2);

    // Thinking should NOT be tagged with any step (no in_progress step)
    tm.pushThinking("some thinking", 3);
    const segs = tm.getSegments();
    const thinking = segs.find((s) => s.type === "thinking");
    expect(thinking?.planStepId).toBeUndefined();

    // End the current thinking segment (simulates a tool event boundary)
    tm.endThinking();

    // Now mark s2 in_progress (s2 is NOT the last step, so thinking nests under it)
    tm.pushPlan([makeStep("s2", "Step 2", "in_progress")], 4);

    // New thinking should nest under s2
    tm.pushThinking("more thinking", 5);
    const segs2 = tm.getSegments();
    const thinking2 = segs2.filter((s) => s.type === "thinking");
    // The second thinking segment should have planStepId=s2
    const lastThinking = thinking2[thinking2.length - 1];
    expect(lastThinking?.planStepId).toBe("s2");
  });

  it("handles multiple sequential status updates correctly", () => {
    const tm = new SupervisorTimelineManager();
    // 5-step plan (matching the real A2A stream from the bug report)
    tm.pushPlan(
      [
        makeStep("s1", "Search SCS", "in_progress"),
        makeStep("s2", "Search networking", "pending"),
        makeStep("s3", "Search DNS setup", "pending"),
        makeStep("s4", "Find code samples", "pending"),
        makeStep("s5", "Synthesize guide", "pending"),
      ],
      1,
    );

    // Status update 1: s1 completed
    tm.pushPlan([makeStep("s1", "Search SCS", "completed")], 2);
    expect(tm.getSegments()[0].planSteps).toHaveLength(5);
    expect(tm.getSegments()[0].planSteps![0].status).toBe("completed");

    // Status update 2: s2 in_progress
    tm.pushPlan([makeStep("s2", "Search networking", "in_progress")], 3);
    expect(tm.getSegments()[0].planSteps).toHaveLength(5);
    expect(tm.getSegments()[0].planSteps![1].status).toBe("in_progress");

    // Status update 3: s2 completed
    tm.pushPlan([makeStep("s2", "Search networking", "completed")], 4);
    expect(tm.getSegments()[0].planSteps).toHaveLength(5);
    expect(tm.getSegments()[0].planSteps![1].status).toBe("completed");
    // Other steps still unchanged
    expect(tm.getSegments()[0].planSteps![2].status).toBe("pending");
    expect(tm.getSegments()[0].planSteps![3].status).toBe("pending");
    expect(tm.getSegments()[0].planSteps![4].status).toBe("pending");
  });
});

// ─── Final answer ────────────────────────────────────────────────────────────

describe("SupervisorTimelineManager final answer", () => {
  it("pushFinalAnswer creates the final_answer segment", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushFinalAnswer("The complete answer", 1);
    const segs = tm.getSegments();
    const finalAnswer = segs.find((s) => s.type === "final_answer");
    expect(finalAnswer).toBeDefined();
    expect(finalAnswer?.content).toBe("The complete answer");
  });

  it("pushFinalAnswer replaces existing final_answer content", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushFinalAnswer("Part 1", 1);
    tm.pushFinalAnswer("Part 2 (authoritative)", 2);
    const finalAnswer = tm.getSegments().find((s) => s.type === "final_answer");
    expect(finalAnswer?.content).toBe("Part 2 (authoritative)");
  });

  it("non-authoritative pushFinalAnswer appends (live streaming)", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushFinalAnswer("chunk1", 1, false);
    tm.pushFinalAnswer(" chunk2", 2, false);
    const finalAnswer = tm.getSegments().find((s) => s.type === "final_answer");
    expect(finalAnswer?.content).toBe("chunk1 chunk2");
    expect(finalAnswer?.isStreaming).toBe(true);
  });

  it("authoritative pushFinalAnswer replaces streamed chunks", () => {
    const tm = new SupervisorTimelineManager();
    // Simulate streaming chunks
    tm.pushFinalAnswer("chunk1", 1, false);
    tm.pushFinalAnswer(" chunk2", 2, false);
    // Then authoritative final_result arrives
    tm.pushFinalAnswer("The authoritative answer", 3);
    const finalAnswer = tm.getSegments().find((s) => s.type === "final_answer");
    expect(finalAnswer?.content).toBe("The authoritative answer");
    expect(finalAnswer?.isStreaming).toBe(false);
  });

  it("thinking during any plan step stays as thinking (no auto-promotion)", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushPlan(
      [
        makeStep("s1", "Research", "completed"),
        makeStep("s2", "Synthesize", "in_progress"),
      ],
      1,
    );

    tm.pushThinking("Working on synthesis...", 2);
    const segs = tm.getSegments();
    expect(segs.find((s) => s.type === "final_answer")).toBeUndefined();
    const thinking = segs.find((s) => s.type === "thinking");
    expect(thinking).toBeDefined();
    expect(thinking?.planStepId).toBe("s2");
  });
});

describe("SupervisorTimelineManager final answer replaces thinking", () => {
  it("first streaming final answer removes active thinking and streams live", () => {
    const tm = new SupervisorTimelineManager();
    tm.pushPlan(
      [
        makeStep("s1", "Research", "completed"),
        makeStep("s2", "Synthesize", "in_progress"),
      ],
      1,
    );

    // Supervisor streams thinking under s2
    tm.pushThinking("Working on it...", 2);
    expect(tm.getSegments().filter((s) => s.type === "thinking")).toHaveLength(1);

    // Backend tags streaming chunks as is_final_answer → UI calls pushFinalAnswer(non-authoritative)
    tm.pushFinalAnswer("Here is the ", 3, false);
    // Thinking should be gone, replaced by final_answer
    expect(tm.getSegments().filter((s) => s.type === "thinking")).toHaveLength(0);
    let fa = tm.getSegments().find((s) => s.type === "final_answer");
    expect(fa?.content).toBe("Here is the ");
    expect(fa?.isStreaming).toBe(true);

    // More streaming chunks append
    tm.pushFinalAnswer("complete answer.", 4, false);
    fa = tm.getSegments().find((s) => s.type === "final_answer");
    expect(fa?.content).toBe("Here is the complete answer.");

    // Authoritative final_result replaces
    tm.pushFinalAnswer("Here is the complete answer.", 5);
    fa = tm.getSegments().find((s) => s.type === "final_answer");
    expect(fa?.content).toBe("Here is the complete answer.");
    expect(fa?.isStreaming).toBe(false);
  });
});

// ─── seedFromPrevious (HITL plan continuity) ─────────────────────────────────

describe("SupervisorTimelineManager.seedFromPrevious", () => {
  it("carries forward a plan from a previous message's segments", () => {
    // Simulate the previous message's timeline
    const prevTm = new SupervisorTimelineManager();
    prevTm.pushPlan(
      [
        makeStep("s1", "Get Jira fields", "completed"),
        makeStep("s2", "Prompt user", "in_progress"),
        makeStep("s3", "Create ticket", "pending"),
      ],
      1,
    );
    prevTm.pushThinking("Narration under step s1", 2);
    const prevSegments = prevTm.getSegments();
    // Tag the thinking with planStepId (simulates what pushThinking does when hasPlan)
    const thinkingSeg = prevSegments.find((s) => s.type === "thinking");
    if (thinkingSeg) thinkingSeg.planStepId = "s1";

    // New timeline for the HITL resume message
    const tm = new SupervisorTimelineManager();
    tm.seedFromPrevious(prevSegments);

    const segs = tm.getSegments();
    // Plan was seeded
    const plan = segs.find((s) => s.type === "execution_plan");
    expect(plan).toBeDefined();
    expect(plan!.planSteps).toHaveLength(3);
    expect(plan!.planSteps![0].status).toBe("completed");
    expect(plan!.planSteps![1].status).toBe("in_progress");

    // Nested thinking was carried forward
    const thinking = segs.find((s) => s.type === "thinking" && s.planStepId === "s1");
    expect(thinking).toBeDefined();
  });

  it("merges status updates into a seeded plan", () => {
    const prevTm = new SupervisorTimelineManager();
    prevTm.pushPlan(
      [
        makeStep("s1", "Get fields", "completed"),
        makeStep("s2", "Prompt user", "in_progress"),
        makeStep("s3", "Create ticket", "pending"),
      ],
      1,
    );

    const tm = new SupervisorTimelineManager();
    tm.seedFromPrevious(prevTm.getSegments());

    // Resume stream sends status update: s2 completed, s3 in_progress
    tm.pushPlan(
      [
        makeStep("s2", "Prompt user", "completed"),
        makeStep("s3", "Create ticket", "in_progress"),
      ],
      2,
    );

    const steps = tm.getSegments().find((s) => s.type === "execution_plan")!.planSteps!;
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ id: "s1", status: "completed" });
    expect(steps[1]).toMatchObject({ id: "s2", status: "completed" });
    expect(steps[2]).toMatchObject({ id: "s3", status: "in_progress" });
  });

  it("routes thinking to correct plan step after seeding", () => {
    const prevTm = new SupervisorTimelineManager();
    prevTm.pushPlan(
      [
        makeStep("s1", "Step 1", "completed"),
        makeStep("s2", "Step 2", "in_progress"),
        makeStep("s3", "Step 3", "pending"),
      ],
      1,
    );

    const tm = new SupervisorTimelineManager();
    tm.seedFromPrevious(prevTm.getSegments());

    // Thinking should nest under s2 (the active step, not the last step)
    tm.pushThinking("working on step 2", 2);
    const thinking = tm.getSegments().find(
      (s) => s.type === "thinking" && s.planStepId === "s2",
    );
    expect(thinking).toBeDefined();
    expect(thinking!.content).toBe("working on step 2");
  });

  it("is a no-op when previous message has no plan", () => {
    const tm = new SupervisorTimelineManager();
    tm.seedFromPrevious([
      {
        id: "thinking-1",
        type: "thinking",
        timestamp: new Date(),
        content: "some narration",
      },
    ]);

    // Should have no segments (standalone thinking without planStepId is not carried)
    expect(tm.getSegments()).toHaveLength(0);
  });
});

// ─── buildFromAGUIEvents — raw AG-UI event format ────────────────────────────

describe("SupervisorTimelineManager.buildFromAGUIEvents", () => {
  it("creates tool_call segments from TOOL_CALL_START and TOOL_CALL_END", () => {
    const events: BaseEvent[] = [
      { type: EventType.TOOL_CALL_START, toolCallId: "tc-1", toolCallName: "search_docs", timestamp: Date.now() } as any,
      { type: EventType.TOOL_CALL_END, toolCallId: "tc-1", timestamp: Date.now() } as any,
    ];

    const segments = SupervisorTimelineManager.buildFromAGUIEvents(events);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("tool_call");
    expect(segments[0].toolCall?.tool).toBe("search_docs");
    expect(segments[0].toolCall?.status).toBe("completed");
  });

  it("creates execution_plan segment from STATE_DELTA with /steps path", () => {
    const steps = [
      { id: "s1", agent: "Agent", description: "Step one", status: "in_progress" },
      { id: "s2", agent: "Agent", description: "Step two", status: "pending" },
    ];
    const events: BaseEvent[] = [
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: "/steps", value: steps }],
        timestamp: Date.now(),
      } as any,
    ];

    const segments = SupervisorTimelineManager.buildFromAGUIEvents(events);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("execution_plan");
    expect(segments[0].planSteps).toHaveLength(2);
    expect(segments[0].planSteps![0]).toMatchObject({ id: "s1", status: "in_progress" });
  });

  it("creates thinking segment from TEXT_MESSAGE_CONTENT before plan", () => {
    const events: BaseEvent[] = [
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Let me think...", timestamp: Date.now() } as any,
    ];

    const segments = SupervisorTimelineManager.buildFromAGUIEvents(events);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("thinking");
    expect(segments[0].content).toBe("Let me think...");
  });

  it("creates final_answer segment from TEXT_MESSAGE_CONTENT after plan", () => {
    const steps = [{ id: "s1", agent: "Agent", description: "Step", status: "in_progress" }];
    const events: BaseEvent[] = [
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: "/steps", value: steps }],
        timestamp: Date.now(),
      } as any,
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Here is the answer.", timestamp: Date.now() } as any,
    ];

    const segments = SupervisorTimelineManager.buildFromAGUIEvents(events);
    const answer = segments.find((s) => s.type === "final_answer");
    expect(answer).toBeDefined();
    expect(answer?.content).toBe("Here is the answer.");
  });

  it("handles a full sequence: text -> plan -> tool -> text", () => {
    const steps = [
      { id: "s1", agent: "Agent", description: "Search", status: "in_progress" },
    ];
    const events: BaseEvent[] = [
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Thinking...", timestamp: Date.now() } as any,
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: "/steps", value: steps }],
        timestamp: Date.now(),
      } as any,
      { type: EventType.TOOL_CALL_START, toolCallId: "tc-1", toolCallName: "search_docs", timestamp: Date.now() } as any,
      { type: EventType.TOOL_CALL_END, toolCallId: "tc-1", timestamp: Date.now() } as any,
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Done.", timestamp: Date.now() } as any,
    ];

    const segments = SupervisorTimelineManager.buildFromAGUIEvents(events);
    const types = segments.map((s) => s.type);
    expect(types).toContain("thinking");
    expect(types).toContain("execution_plan");
    expect(types).toContain("tool_call");
    expect(types).toContain("final_answer");

    const answer = segments.find((s) => s.type === "final_answer");
    expect(answer?.content).toBe("Done.");
  });

  it("returns empty array for empty event list", () => {
    expect(SupervisorTimelineManager.buildFromAGUIEvents([])).toHaveLength(0);
  });
});
