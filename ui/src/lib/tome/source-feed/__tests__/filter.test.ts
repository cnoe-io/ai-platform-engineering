import {
  isGithubSourceEvent,
  sourceEventLabels,
  sourceEventMatchesLabel,
} from "@/lib/tome/source-feed/filter";

const discussionEvent = {
  message_type: "event",
  metadata: {
    kind: "source_event",
    payload: {
      source: "github",
      artifact: "discussion",
      labels: ["decision", "critical"],
    },
  },
};

describe("source feed label filter", () => {
  it("identifies GitHub source events without hiding other TOME events", () => {
    expect(isGithubSourceEvent(discussionEvent)).toBe(true);
    expect(isGithubSourceEvent({
      message_type: "event",
      metadata: { kind: "ingest_event" },
    })).toBe(false);
    expect(isGithubSourceEvent({ message_type: "broadcast" })).toBe(false);
  });

  it("uses labels from GitHub issue and discussion event payloads", () => {
    expect(sourceEventLabels(discussionEvent)).toEqual(["decision", "critical"]);
    expect(sourceEventMatchesLabel(discussionEvent, "Decision")).toBe(true);
    expect(sourceEventMatchesLabel(discussionEvent, "question")).toBe(false);
  });

  it("excludes unlabelled conversation and non-source events when filtered", () => {
    expect(sourceEventMatchesLabel({ message_type: "broadcast" }, "decision"))
      .toBe(false);
    expect(sourceEventMatchesLabel({
      message_type: "event",
      metadata: { kind: "ingest_event" },
    }, "decision")).toBe(false);
  });
});
