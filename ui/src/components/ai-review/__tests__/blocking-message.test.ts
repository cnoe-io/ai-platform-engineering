/**
 * Unit tests for buildBlockingMessage — the message shown when a blocking AI
 * Review gates Next/Save. Verifies it names the admin-required grade (derived
 * from min_score) and the grade the content actually scored.
 */

import { buildBlockingMessage } from "../blocking-message";
import type { ReviewConfig, ReviewResult } from "@/types/ai-review";

function config(min_score: number): ReviewConfig {
  return {
    _id: "agent-system-prompt",
    target: "agent-system-prompt",
    label: "Agent",
    enabled: true,
    enforcement: "blocking",
    min_score,
    grade_thresholds: { A: 0.9, B: 0.8, C: 0.7, D: 0.6 },
    criteria: [],
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function result(score: number, grade: ReviewResult["grade"]): ReviewResult {
  return {
    hash: "h",
    score,
    grade,
    passed: false,
    enforcement: "blocking",
    criteria: [],
    total: 0,
    passed_count: 0,
    model: { id: "m", provider: "p" },
  };
}

describe("buildBlockingMessage", () => {
  it("names the required grade derived from min_score", () => {
    // min_score 0.7 buckets to grade C.
    const msg = buildBlockingMessage(config(0.7), null, "the Instructions step", "saving");
    expect(msg).toContain("at least grade C");
    expect(msg).toContain("set by your admin");
    expect(msg).toContain("Address the comments in the Instructions step before saving.");
  });

  it("includes the scored grade and percentage when a result exists", () => {
    const msg = buildBlockingMessage(config(0.8), result(0.55, "F"), "the comments", "continuing");
    expect(msg).toContain("at least grade B");
    expect(msg).toContain("this scored F (55%)");
    expect(msg).toContain("before continuing");
  });

  it("rounds the scored percentage", () => {
    const msg = buildBlockingMessage(config(0.9), result(0.666, "D"), "the step", "saving");
    expect(msg).toContain("(67%)");
  });

  it("falls back to a generic message when config is missing", () => {
    const msg = buildBlockingMessage(null, null, "the step", "saving");
    expect(msg).toContain("AI Review failed");
    expect(msg).toContain("Address the comments in the step before saving.");
  });
});
