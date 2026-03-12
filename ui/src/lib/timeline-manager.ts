/**
 * TimelineManager — encapsulates all timeline segment mutation logic.
 *
 * Used by ChatPanel's streaming loop to build timeline segments.
 * Replaces the inline mutation of a bare TimelineSegment[] array
 * with a class that owns the segments + tracking state.
 */

import type { TimelineSegment, PlanStep } from "@/types/a2a";

export class TimelineManager {
  private segments: TimelineSegment[] = [];
  private currentThinkingId: string | null = null;
  private currentPlanStepId: string | null = null;
  private hasPlan = false;

  /** End the current thinking segment (set isStreaming=false, clear tracking). */
  endThinking(): void {
    if (this.currentThinkingId) {
      const seg = this.segments.find((s) => s.id === this.currentThinkingId);
      if (seg) seg.isStreaming = false;
      this.currentThinkingId = null;
    }
  }

  /** Check whether the currently active plan step is the last one in the plan. */
  private isLastPlanStepActive(): boolean {
    if (!this.hasPlan || !this.currentPlanStepId) return false;
    const planSeg = this.segments.find((s) => s.type === "execution_plan");
    const steps = planSeg?.planSteps;
    if (!steps || steps.length === 0) return false;
    const lastStep = steps[steps.length - 1];
    return lastStep.id === this.currentPlanStepId && lastStep.status === "in_progress";
  }

  /** Append to current thinking or create a new one. Tags with planStepId if post-plan. */
  pushThinking(content: string, eventNum: number): void {
    // When the last plan step is active, stream content as the final answer
    // instead of nesting it as thinking under the plan step.
    if (this.isLastPlanStepActive()) {
      this.endThinking();
      const existing = this.segments.find((s) => s.type === "final_answer");
      if (existing) {
        existing.content = (existing.content || "") + content;
        existing.isStreaming = true;
      } else {
        this.segments.push({
          id: `answer-${eventNum}`,
          type: "final_answer",
          timestamp: new Date(),
          content,
          isStreaming: true,
        });
      }
      return;
    }

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
      // Merge: preserve completed/failed statuses from existing steps
      const existing = this.segments[existingIdx].planSteps || [];
      const existingMap = new Map(existing.map((s) => [s.id, s]));
      const merged = planSteps.map((s) => {
        const old = existingMap.get(s.id);
        if (old && (old.status === "completed" || old.status === "failed")) {
          return { ...s, status: old.status };
        }
        return s;
      });
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
    // Clear when no step is in_progress so the LLM's final answer
    // (streamed as thinking) doesn't nest under the last completed step.
    this.hasPlan = true;
    const activeStep = planSteps.find((s) => s.status === "in_progress");
    this.currentPlanStepId = activeStep ? activeStep.id : null;
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

  /** Create or append to a final_answer segment. */
  pushFinalAnswer(content: string, eventNum: number): void {
    // The last thinking segment likely contains the same content that's now
    // arriving as the final answer (the LLM streams answer text before
    // final_result is emitted). Remove it to avoid duplication.
    const lastThinkingIdx = this.currentThinkingId
      ? this.segments.findIndex((s) => s.id === this.currentThinkingId)
      : -1;
    if (lastThinkingIdx >= 0) {
      this.segments.splice(lastThinkingIdx, 1);
      this.currentThinkingId = null;
    } else {
      this.endThinking();
    }

    // If a final_answer segment already exists (e.g. from streaming last-step
    // thinking), replace its content with the authoritative final_result.
    const existing = this.segments.find((s) => s.type === "final_answer");
    if (existing) {
      existing.content = content;
      existing.isStreaming = false;
    } else {
      this.segments.push({
        id: `answer-${eventNum}`,
        type: "final_answer",
        timestamp: new Date(),
        content,
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
  getSegments(): TimelineSegment[] {
    return [...this.segments];
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
}
