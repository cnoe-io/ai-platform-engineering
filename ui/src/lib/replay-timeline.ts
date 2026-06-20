// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Replay-from-history → TimelineSegments builder.
 *
 * Spec #099 Phase B / Story 2 — used by the autonomous-task chat
 * synthesiser to reproduce the same Plan + Tools + Thinking +
 * FinalAnswer timeline a typed message gets streamed in real-time
 * from raw A2A events that were captured server-side and persisted on
 * the TaskRun. Without this, scheduled fires render as a flat markdown
 * bubble with no plan or tool affordances; this helper closes the gap.
 *
 * Mirrors the event-processing logic in ``ChatPanel.submitMessage``'s
 * streaming loop (the BUILD TIMELINE SEGMENTS block around L560). Kept
 * in its own file rather than refactored out of ChatPanel because the
 * streaming code is large + fragile, and a separate replay function
 * means the streaming path stays untouched (zero risk of regressing
 * the live-chat experience that today already works).
 */

import type { ArtifactPart, SupervisorTimelineSegment } from "@/types/a2a";
import { parsePlanStepsFromData, parseToolFromArtifact } from "@/lib/timeline-parsers";
import { SupervisorTimelineManager } from "@/lib/timeline-manager";

/**
 * Pull the first text body out of an artifact's ``parts``.
 * Returns ``""`` when the artifact has no textual content (e.g.
 * data-only artifacts like ``execution_plan_update``).
 */
function _firstText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { kind?: string; text?: string; root?: { kind?: string; text?: string } };
    if (p.kind === "text" && typeof p.text === "string") return p.text;
    if (p.root && p.root.kind === "text" && typeof p.root.text === "string") return p.root.text;
  }
  return "";
}

/**
 * Walk the captured A2A events for a single run and produce the
 * TimelineSegment[] the chat renderer expects. Order matters: the
 * supervisor's events arrive chronologically, and the segment list
 * preserves that order so the UI's collapsible Plan / Tools / Thinking
 * sections stack correctly.
 *
 * Failure mode: any malformed event is silently skipped — a single bad
 * payload mustn't break replay of the rest. The result is conservative:
 * if all events are malformed we return an empty segments array and the
 * renderer falls back to the plain bubble (which is still useful).
 */
export function buildTimelineSegmentsFromEvents(
  events: ReadonlyArray<Record<string, unknown>>,
): SupervisorTimelineSegment[] {
  if (!events || events.length === 0) return [];
  const timeline = new SupervisorTimelineManager();
  let eventNum = 0;

  for (const event of events) {
    eventNum += 1;
    if (!event || typeof event !== "object") continue;
    if ((event as { kind?: string }).kind !== "artifact-update") continue;

    const artifact = (event as { artifact?: Record<string, unknown> }).artifact;
    if (!artifact || typeof artifact !== "object") continue;

    const artifactName = (artifact as { name?: string }).name || "";
    const parts = (artifact as { parts?: unknown }).parts;
    const newContent = _firstText(parts);

    if (artifactName === "execution_plan_update" || artifactName === "execution_plan_status_update") {
      // Plan artifacts carry their data in DataPart, not TextPart.
      let planSteps = [] as ReturnType<typeof parsePlanStepsFromData>;
      if (Array.isArray(parts)) {
        for (const part of parts as Array<{ kind?: string; data?: unknown; root?: { kind?: string; data?: unknown } }>) {
          if (part.kind === "data" && part.data) {
            planSteps = parsePlanStepsFromData(part.data);
            if (planSteps.length > 0) break;
          }
          if (part.root && part.root.kind === "data" && part.root.data) {
            planSteps = parsePlanStepsFromData(part.root.data);
            if (planSteps.length > 0) break;
          }
        }
      }
      if (planSteps.length > 0) timeline.pushPlan(planSteps, eventNum);
    } else if (artifactName === "tool_notification_start") {
      // parseToolFromArtifact wants the renderer's Artifact shape.
      // Our captured artifact dicts are already close to that shape;
      // pass through the fields the parser inspects.
      const toolInfo = parseToolFromArtifact({
        artifactId: ((artifact as { artifactId?: string }).artifactId) || "",
        name: ((artifact as { name?: string }).name) || "",
        description: ((artifact as { description?: string }).description) || "",
        parts: (Array.isArray(parts) ? (parts as ArtifactPart[]) : []),
        metadata: (artifact as { metadata?: Record<string, unknown> }).metadata,
      });
      if (toolInfo) timeline.pushToolStart(toolInfo, eventNum);
    } else if (artifactName === "tool_notification_end") {
      const description = (artifact as { description?: string }).description || "";
      const descMatch = description.match(/Tool call (?:completed|started):\s*(.+)/i);
      const toolName = descMatch ? descMatch[1].trim() : "";
      timeline.completeToolByName(toolName);
    } else if (artifactName === "final_result" || artifactName === "partial_result") {
      if (newContent) timeline.pushFinalAnswer(newContent, eventNum);
    } else if (artifactName === "complete_result") {
      if (newContent) timeline.pushThinking(newContent, eventNum);
    } else if (newContent) {
      // Non-special-named artifact with text content → treat as
      // streaming/thinking. The renderer surfaces these inline under
      // the active plan step (or as bare thinking if no plan).
      const meta = (artifact as { metadata?: { is_final_answer?: boolean } }).metadata;
      if (meta?.is_final_answer === true) {
        timeline.pushFinalAnswer(newContent, eventNum, false);
      } else {
        timeline.pushThinking(newContent, eventNum);
      }
    }
  }

  // Replay is by definition complete. Finalize mirrors the live
  // streaming onDone path: it stops any open text stream and closes
  // notification pseudo-tools such as "composing_answer" that may not
  // have a matching tool_notification_end artifact in persisted A2A
  // history.
  timeline.finalize();

  return timeline.getSegments();
}
