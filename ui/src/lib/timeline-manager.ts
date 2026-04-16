/**
 * SupervisorTimelineManager — encapsulates all timeline segment mutation logic.
 *
 * Used by SupervisorChatPanel's streaming loop to build timeline segments.
 * Replaces the inline mutation of a bare SupervisorTimelineSegment[] array
 * with a class that owns the segments + tracking state.
 */

import type { SupervisorTimelineSegment, PlanStep } from "@/types/a2a";
import { parsePlanStepsFromData, parsePlanStepsFromTodos } from "./timeline-parsers";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, TextMessageContentEvent, ToolCallStartEvent, ToolCallEndEvent, StateDeltaEvent, StateSnapshotEvent } from "@ag-ui/core";

export class SupervisorTimelineManager {
  private segments: SupervisorTimelineSegment[] = [];
  private currentThinkingId: string | null = null;
  private currentPlanStepId: string | null = null;
  private hasPlan = false;

  /**
   * Seed the timeline with an existing plan (e.g. from a previous message).
   * Used by HITL resume to carry a plan forward across form submissions.
   * Also accepts tool/thinking segments that were nested under the plan.
   */
  seedFromPrevious(segments: SupervisorTimelineSegment[]): void {
    // Import the execution plan
    const planSeg = segments.find((s) => s.type === "execution_plan");
    if (planSeg) {
      this.segments.push({ ...planSeg });
      this.hasPlan = true;
      const activeStep = planSeg.planSteps?.find((s) => s.status === "in_progress");
      this.currentPlanStepId = activeStep ? activeStep.id : null;
    }

    // Import tool calls that are nested under plan steps
    for (const seg of segments) {
      if (seg.type === "tool_call" && seg.toolCall?.planStepId) {
        this.segments.push({ ...seg });
      }
    }

    // Import thinking segments nested under plan steps
    for (const seg of segments) {
      if (seg.type === "thinking" && seg.planStepId) {
        this.segments.push({ ...seg });
      }
    }
  }

  /** End the current thinking segment (set isStreaming=false, clear tracking). */
  endThinking(): void {
    if (this.currentThinkingId) {
      const seg = this.segments.find((s) => s.id === this.currentThinkingId);
      if (seg) seg.isStreaming = false;
      this.currentThinkingId = null;
    }
  }

  /** Append to current thinking or create a new one. Tags with planStepId if post-plan. */
  pushThinking(content: string, eventNum: number): void {
    if (this.currentThinkingId) {
      const seg = this.segments.find((s) => s.id === this.currentThinkingId);
      if (seg) {
        seg.content = (seg.content || "") + content;
        seg.isStreaming = true;
      }
    } else {
      const id = `thinking-${eventNum}`;
      this.currentThinkingId = id;
      this.segments.push({
        id,
        type: "thinking",
        timestamp: new Date(),
        content,
        isStreaming: true,
        planStepId: this.hasPlan ? (this.currentPlanStepId || undefined) : undefined,
      });
    }
  }

  /** Create or merge an execution_plan segment from parsed PlanStep[]. */
  pushPlan(planSteps: PlanStep[], eventNum: number): void {
    const existingIdx = this.segments.findIndex((s) => s.type === "execution_plan");

    if (existingIdx >= 0) {
      // Merge incoming steps INTO the existing plan.
      // Status updates only contain changed steps, not the full plan,
      // so we must preserve all existing steps and apply updates by id.
      const existing = this.segments[existingIdx].planSteps || [];
      const incomingMap = new Map(planSteps.map((s) => [s.id, s]));
      const merged = existing.map((s) => {
        const update = incomingMap.get(s.id);
        if (update) return update;
        return s;
      });
      // Append any new steps not already in the plan
      for (const s of planSteps) {
        if (!merged.some((m) => m.id === s.id)) {
          merged.push(s);
        }
      }
      this.segments[existingIdx] = {
        ...this.segments[existingIdx],
        planSteps: merged,
      };
    } else {
      // New plan — end thinking first
      this.endThinking();
      this.segments.push({
        id: `plan-${eventNum}`,
        type: "execution_plan",
        timestamp: new Date(),
        planSteps,
      });
    }

    // Track active plan step for nesting.
    // Use the merged plan (not just incoming steps) to find the active step,
    // since status updates only contain changed steps.
    this.hasPlan = true;
    const currentPlan = this.segments[existingIdx >= 0 ? existingIdx : this.segments.length - 1]?.planSteps || planSteps;
    const activeStep = currentPlan.find((s) => s.status === "in_progress");
    this.currentPlanStepId = activeStep ? activeStep.id : null;
  }

  /** Mark the current in_progress plan step as input_required (waiting for user). */
  markPlanInputRequired(): void {
    if (!this.hasPlan || !this.currentPlanStepId) return;
    const planSeg = this.segments.find((s) => s.type === "execution_plan");
    const step = planSeg?.planSteps?.find((s) => s.id === this.currentPlanStepId);
    if (step) step.status = "input_required";
  }

  /** Create a tool_call segment (status=running). Calls endThinking() first. */
  pushToolStart(
    info: { agent: string; tool: string; planStepId?: string },
    eventNum: number,
  ): void {
    this.endThinking();
    this.segments.push({
      id: `tool-${eventNum}`,
      type: "tool_call",
      timestamp: new Date(),
      toolCall: {
        id: `tool-${eventNum}`,
        agent: info.agent,
        tool: info.tool,
        status: "running",
        planStepId: info.planStepId,
      },
    });
  }

  /** Mark the most recent matching running tool as completed. */
  completeToolByName(toolName: string): void {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i];
      if (seg.type === "tool_call" && seg.toolCall?.status === "running") {
        if (!toolName || seg.toolCall.tool.toLowerCase() === toolName.toLowerCase()) {
          seg.toolCall = { ...seg.toolCall, status: "completed" };
          break;
        }
      }
    }
  }

  /**
   * Create, append to, or replace a final_answer segment.
   *
   * @param authoritative When true (default), replaces any existing final_answer
   *   content — used for the definitive final_result/partial_result artifact.
   *   When false, appends to the existing segment — used for live-streaming
   *   chunks tagged with is_final_answer by the backend.
   */
  pushFinalAnswer(content: string, eventNum: number, authoritative = true): void {
    const existing = this.segments.find((s) => s.type === "final_answer");

    if (existing) {
      if (authoritative) {
        // Authoritative final_result replaces whatever was streamed so far
        existing.content = content;
        existing.isStreaming = false;
      } else {
        // Streaming chunk — append
        existing.content = (existing.content || "") + content;
        existing.isStreaming = true;
      }
    } else {
      // First final_answer — remove the current thinking segment to avoid
      // duplication (the LLM streams answer text before final_result is emitted).
      const lastThinkingIdx = this.currentThinkingId
        ? this.segments.findIndex((s) => s.id === this.currentThinkingId)
        : -1;
      if (lastThinkingIdx >= 0) {
        this.segments.splice(lastThinkingIdx, 1);
        this.currentThinkingId = null;
      } else {
        this.endThinking();
      }

      this.segments.push({
        id: `answer-${eventNum}`,
        type: "final_answer",
        timestamp: new Date(),
        content,
        isStreaming: !authoritative,
      });
    }
  }

  /** Called when stream ends: mark all thinking/answers as !isStreaming, running tools as completed. */
  finalize(): void {
    for (const seg of this.segments) {
      if (seg.type === "thinking" || seg.type === "final_answer") seg.isStreaming = false;
      if (seg.type === "tool_call" && seg.toolCall?.status === "running") {
        seg.toolCall = { ...seg.toolCall, status: "completed" };
      }
    }
  }

  /** Return a shallow copy of segments for React (new array ref). */
  getSegments(): SupervisorTimelineSegment[] {
    return [...this.segments];
  }

  /** Get the current in-progress plan step ID (for nesting tool calls). */
  getCurrentPlanStepId(): string | null {
    return this.currentPlanStepId;
  }

  /** Whether a plan has been pushed. */
  getHasPlan(): boolean {
    return this.hasPlan;
  }

  /** Quick stats for the summary bar. */
  getStats(): { toolCount: number; stepCount: number; completedTools: number } {
    const tools = this.segments.filter((s) => s.type === "tool_call");
    const planSeg = this.segments.find((s) => s.type === "execution_plan");
    return {
      toolCount: tools.length,
      stepCount: planSeg?.planSteps?.length ?? 0,
      completedTools: tools.filter((s) => s.toolCall?.status === "completed").length,
    };
  }

  /**
   * Reconstruct a timeline from raw AG-UI events persisted by the backend.
   *
   * AG-UI → timeline segment mapping:
   *   TOOL_CALL_START  → tool_call segment (status: running)
   *   TOOL_CALL_END    → tool_call segment (status: completed)
   *   STATE_DELTA      → execution_plan segment (when patch contains /steps)
   *   TEXT_MESSAGE_CONTENT → thinking or final_answer segment
   */
  static buildFromAGUIEvents(events: BaseEvent[]): SupervisorTimelineSegment[] {
    const manager = new SupervisorTimelineManager();
    // Track active tool calls (toolCallId → toolName) for TOOL_CALL_END lookup
    const activeToolCalls = new Map<string, string>();
    // Track accumulated state for STATE_DELTA application
    let agentState: Record<string, unknown> = {};

    events.forEach((event, idx) => {
      const eventNum = idx + 1;

      switch (event.type) {
        case EventType.TEXT_MESSAGE_CONTENT: {
          const e = event as TextMessageContentEvent;
          if (e.delta) {
            // During streaming: text before plan = thinking; text after plan = final_answer.
            // Check whether a plan segment already exists to decide which segment type to use.
            const hasPlanSegment = manager.getSegments().some((s) => s.type === "execution_plan");
            if (hasPlanSegment) {
              manager.pushFinalAnswer(e.delta, eventNum, /* authoritative */ false);
            } else {
              manager.pushThinking(e.delta, eventNum);
            }
          }
          break;
        }

        case EventType.TOOL_CALL_START: {
          const e = event as ToolCallStartEvent;
          const toolName = e.toolCallName ?? e.toolCallId ?? "Unknown Tool";
          activeToolCalls.set(e.toolCallId, toolName);
          manager.pushToolStart(
            { agent: toolName, tool: toolName, planStepId: manager.getCurrentPlanStepId() || undefined },
            eventNum,
          );
          break;
        }

        case EventType.TOOL_CALL_END: {
          const e = event as ToolCallEndEvent;
          const toolName = activeToolCalls.get(e.toolCallId) ?? e.toolCallId;
          activeToolCalls.delete(e.toolCallId);
          manager.completeToolByName(toolName);
          break;
        }

        case EventType.STATE_DELTA: {
          const e = event as StateDeltaEvent;
          if (!Array.isArray(e.delta)) break;

          // Apply the patch to maintain a running state snapshot
          for (const op of e.delta as Array<{ op: string; path: string; value?: unknown }>) {
            if (op.op === "replace" || op.op === "add") {
              // Handle top-level /steps or /plan/steps paths
              if (op.path === "/steps" || op.path === "/plan/steps") {
                agentState = { ...agentState, steps: op.value };
              }
            }
          }

          // If the state now has steps, push/merge the plan
          if (Array.isArray(agentState.steps)) {
            const planSteps = parsePlanStepsFromData({ steps: agentState.steps });
            if (planSteps.length > 0) {
              manager.pushPlan(planSteps, eventNum);
            }
          }
          break;
        }

        case EventType.STATE_SNAPSHOT: {
          const e = event as StateSnapshotEvent;
          const snapshot = e.snapshot as Record<string, unknown> | undefined;
          if (snapshot && Array.isArray(snapshot.todos) && snapshot.todos.length > 0) {
            const planSteps = parsePlanStepsFromTodos(snapshot.todos);
            if (planSteps.length > 0) {
              manager.pushPlan(planSteps, eventNum);
            }
          }
          break;
        }

        // RUN_FINISHED, RUN_ERROR, TOOL_CALL_ARGS, etc. — no timeline segment needed
        default:
          break;
      }
    });

    manager.finalize();
    return manager.getSegments();
  }
}
