import { buildTimelineSegmentsFromEvents } from "../replay-timeline";

describe("buildTimelineSegmentsFromEvents", () => {
  it("finalizes notification pseudo-tools that have no explicit end event", () => {
    const segments = buildTimelineSegmentsFromEvents([
      {
        kind: "artifact-update",
        artifact: {
          artifactId: "compose-1",
          name: "tool_notification_start",
          description: "Tool call started: composing_answer",
          metadata: { sourceAgent: "composing_answer" },
          parts: [{ kind: "text", text: "Composing answer..." }],
        },
      },
      {
        kind: "artifact-update",
        artifact: {
          artifactId: "answer-1",
          name: "final_result",
          parts: [{ kind: "text", text: "Done." }],
        },
      },
    ]);

    const composing = segments.find(
      (segment) =>
        segment.type === "tool_call" &&
        segment.toolCall?.tool === "composing_answer",
    );

    expect(composing?.toolCall?.status).toBe("completed");
  });
});
