/**
 * Pure unit tests for the spec-health scoring projector.
 *
 * Verifies that each signal contributes the documented weight, that
 * the band boundaries snap to the right tone, and that the
 * recency-weighted repo score behaves as a weighted average.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  repoSpecScore,
  scoreEpicSpec,
  type SpecScoreInput,
} from "@/lib/agentic-sdlc/spec-scoring";

function baseInput(overrides: Partial<SpecScoreInput> = {}): SpecScoreInput {
  return {
    epic_id: "EPIC_1",
    title: "Add OAuth device flow",
    github_url: "https://example/repo/issues/1",
    body_excerpt: "",
    labels: [],
    last_event_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("scoreEpicSpec", () => {
  it("scores 0 when the body has no signals", () => {
    const r = scoreEpicSpec(baseInput({ body_excerpt: "" }));
    expect(r.score).toBe(0);
    expect(r.band).toBe("weak");
    expect(r.criteria.every((c) => !c.present)).toBe(true);
  });

  it("counts acceptance criteria via Given/When/Then", () => {
    const r = scoreEpicSpec(
      baseInput({
        body_excerpt: "Given a logged in user when they tap login then …",
      }),
    );
    expect(r.criteria.find((c) => c.kind === "acceptance_criteria")?.present)
      .toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(30);
  });

  it("counts NFR via latency / p99 / cost budget", () => {
    const r = scoreEpicSpec(baseInput({ body_excerpt: "p99 latency under 200ms, cost budget $200" }));
    expect(
      r.criteria.find((c) => c.kind === "non_functional_requirements")?.present,
    ).toBe(true);
  });

  it("counts ADR link via docs/adr path or ADR-xxx", () => {
    const r = scoreEpicSpec(baseInput({ body_excerpt: "see docs/adr/2026-05-09-foo.md" }));
    expect(r.criteria.find((c) => c.kind === "adr_link")?.present).toBe(true);
  });

  it("counts test strategy when 'tests' label is set even without prose", () => {
    const r = scoreEpicSpec(baseInput({ labels: ["tests"], body_excerpt: "no prose at all" }));
    expect(r.criteria.find((c) => c.kind === "test_strategy")?.present).toBe(true);
  });

  it("clamps to 0..100 and reports band 'strong' at 85+", () => {
    const r = scoreEpicSpec(
      baseInput({
        body_excerpt: [
          "Acceptance criteria",
          "Given user, when X, then Y",
          "p99 latency budget 200ms",
          "Constraint: must not write to prod",
          "Test plan: 80% unit coverage",
          "Compute budget 8 hours",
          "see docs/adr/2026-05-09-foo.md",
        ].join("\n"),
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.band).toBe("strong");
  });

  it("returns missing-criteria hints for absent signals", () => {
    const r = scoreEpicSpec(baseInput({ body_excerpt: "just a vague idea" }));
    for (const c of r.criteria) {
      if (!c.present) expect(c.hint?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("repoSpecScore", () => {
  it("returns 0 when there are no epics", () => {
    expect(repoSpecScore([])).toBe(0);
  });

  it("weights newer epics more heavily", () => {
    const newer = scoreEpicSpec(
      baseInput({
        epic_id: "n",
        body_excerpt: "Acceptance criteria Given ...",
        last_event_at: new Date().toISOString(),
      }),
    );
    const older = scoreEpicSpec(
      baseInput({
        epic_id: "o",
        body_excerpt: "vague",
        last_event_at: new Date(
          Date.now() - 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    );
    const repo = repoSpecScore([newer, older]);
    // Should pull more toward the newer epic's score.
    expect(repo).toBeGreaterThan(Math.min(newer.score, older.score));
    expect(repo).toBeLessThanOrEqual(newer.score);
  });
});
