/** @jest-environment node */

import {
  assertEvaluationRequestFits,
  abortSignalWithTimeout,
  EvaluationBudget,
  evidenceForFile,
  evaluationChunkCharacterLimit,
  isEvaluatorBudgetFailure,
  isEvaluatorCapacityFailure,
  isTransientEvaluatorFailure,
  isTransientPersistenceFailure,
  mapWithConcurrency,
  normalizeEvaluationResponse,
  pageChunkCharacterLimit,
  retryWithBackoff,
  splitMarkdown,
  splitMarkdownChunk,
} from "@/lib/tome/file-evaluation";

const profile = {
  id: "provider/model-judge",
  model_id: "provider/model-judge",
  profile_version: 1,
  capability_rank: 3,
  context_window_tokens: 20_000,
  max_output_tokens: 4_000,
  supports_structured_output: true,
};

describe("per-file evaluation safeguards", () => {
  it("chunks oversized Markdown at stable boundaries without losing content", () => {
    const markdown = `${"a".repeat(1_500)}\n\n${"b".repeat(1_500)}\n\n${"c".repeat(1_500)}`;
    const chunks = splitMarkdown(markdown, 2_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.markdown).join("")).toBe(markdown);
    expect(chunks.map((chunk) => chunk.startOffset)).toEqual([0, chunks[0].markdown.length, chunks[0].markdown.length + chunks[1].markdown.length]);
  });

  it("halves a turn-exhausted chunk while preserving global offsets", () => {
    const chunk = { index: 4, startOffset: 200, markdown: "a".repeat(4_000) };
    const children = splitMarkdownChunk(chunk);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.markdown).join("")).toBe(chunk.markdown);
    expect(children[0].startOffset).toBe(200);
    expect(children[1].startOffset).toBe(200 + children[0].markdown.length);
  });

  it("aborts an evaluator attempt at its request deadline", async () => {
    const signal = abortSignalWithTimeout(undefined, 5);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal.aborted).toBe(true);
  });

  it("normalizes quoted null and repairs unique claim offsets", () => {
    const normalized = normalizeEvaluationResponse({
      claims: [{
        id: "claim-1",
        page: "ignored.md",
        section: null,
        exact_text: "grounded claim",
        start_offset: 0,
        end_offset: 1,
        classification: "supported",
        reason: "evidence",
        confidence: 1.2,
        abstained: false,
        citations: [],
        evidence: [],
        critical_kind: "null",
      }],
      signals: {},
    }, "page.md", { index: 2, startOffset: 100, markdown: "before grounded claim after" });
    expect(normalized.claims[0]).toMatchObject({
      page: "page.md",
      start_offset: 107,
      end_offset: 121,
      confidence: 1,
      critical_kind: null,
    });
  });

  it("rejects requests that exceed the evaluator input upper bound", () => {
    expect(() => assertEvaluationRequestFits({ evidence: "x".repeat(30_000) }, profile))
      .toThrow("exceeds the model input upper bound");
    expect(() => assertEvaluationRequestFits({ evidence: "small" }, profile)).not.toThrow();
  });

  it("shrinks a file chunk to the remaining input budget after frozen evidence", () => {
    const largerProfile = { ...profile, context_window_tokens: 25_000 };
    const withoutCandidate = { evidence: "x".repeat(26_000), candidate_pages: { "page.md": "" } };
    const limit = evaluationChunkCharacterLimit(withoutCandidate, largerProfile);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(pageChunkCharacterLimit(largerProfile));
    expect(splitMarkdown("a".repeat(limit + 1), limit)).toHaveLength(2);
  });

  it("validates and normalizes evaluator signals", () => {
    const normalized = normalizeEvaluationResponse({
      claims: [],
      signals: {
        semantic_fidelity: { passed: 1, total: 2, findings: ["one", 2] },
        unknown_signal: { passed: 9, total: 9 },
      },
    }, "page.md", { index: 0, startOffset: 0, markdown: "" });
    expect(normalized.signals).toEqual({
      semantic_fidelity: { passed: 1, total: 2, findings: ["one"] },
    });
    expect(() => normalizeEvaluationResponse({
      claims: [],
      signals: { semantic_fidelity: { passed: 3, total: 2 } },
    }, "page.md", { index: 0, startOffset: 0, markdown: "" }))
      .toThrow("invalid semantic_fidelity signal");
  });

  it("retries transient failures with exponential backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await retryWithBackoff({
      attempts: 3,
      action: async () => {
        calls += 1;
        if (calls < 3) throw new Error("Evaluator failed (503)");
        return "ok";
      },
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    });
    expect(result).toEqual({ value: "ok", attempts: 3 });
    expect(sleeps).toEqual([500, 1_000]);
    expect(isTransientEvaluatorFailure(new Error("rate limit"))).toBe(true);
    expect(isTransientEvaluatorFailure(new Error("refusal"))).toBe(false);
  });

  it("classifies retryable persistence failures without retrying validation errors", () => {
    expect(isTransientPersistenceFailure(
      Object.assign(new Error("Socket 'connect' timed out after 30000ms"), {
        name: "MongoNetworkTimeoutError",
        errorLabelSet: new Set(["RetryableError"]),
      }),
    )).toBe(true);
    expect(isTransientPersistenceFailure(new Error("document failed schema validation")))
      .toBe(false);
  });

  it("does not classify evaluator capacity or budget limits as ordinary retries", () => {
    expect(isEvaluatorCapacityFailure(new Error("evaluator exhausted its bounded turn budget")))
      .toBe(true);
    expect(isEvaluatorBudgetFailure(new Error("error_max_budget_usd"))).toBe(true);
  });

  it("selects only evidence relevant to the file under review", () => {
    const items = [
      { id: "project", kind: "project_snapshot", canonical_uri: "tome-project://example", content_hash: "1", content: "project", captured_at: "now" },
      { id: "current", kind: "wiki", canonical_uri: "tome://example/activity.md", content_hash: "2", content: "current", page_path: "activity.md", captured_at: "now" },
      { id: "linked", kind: "github", canonical_uri: "github://example/repo/issues/1", content_hash: "3", content: "linked", page_path: "repos/example/status.md", captured_at: "now" },
      { id: "unrelated", kind: "wiki", canonical_uri: "tome://example/other.md", content_hash: "4", content: "other", page_path: "other.md", captured_at: "now" },
    ] as const;
    expect(evidenceForFile(
      [...items],
      "activity.md",
      "See github://example/repo/issues/1 for details.",
    ).map((item) => item.id)).toEqual(["project", "current", "linked"]);
  });

  it("omits unreferenced templates and seeds from quick file evidence", () => {
    const items = [
      { id: "project", kind: "project_snapshot", canonical_uri: "tome-project://example", content_hash: "1", content: "project", captured_at: "now" },
      { id: "page", kind: "wiki", canonical_uri: "tome://example/architecture.md", content_hash: "2", content: "page", page_path: "architecture.md", captured_at: "now" },
      { id: "template", kind: "template", canonical_uri: "tome-template://top-level@1", content_hash: "3", content: "large template", captured_at: "now" },
      { id: "seed", kind: "seed", canonical_uri: "tome-seed://example", content_hash: "4", content: "large seed", captured_at: "now" },
    ] as const;
    expect(evidenceForFile(
      [...items],
      "architecture.md",
      "Current architecture.",
      { includeUnreferencedScaffolding: false },
    ).map((item) => item.id)).toEqual(["project", "page"]);
  });

  it("reserves concurrent evaluator cost before calls start", () => {
    const budget = new EvaluationBudget(5, 1);
    const first = budget.reserve(2);
    const second = budget.reserve(2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(budget.reserve(0.01)).toBeNull();
    expect(budget.reservedUsd).toBe(4);
    expect(first?.settle(0.5)).toBe(0.5);
    expect(budget.spentUsd).toBe(1.5);
    expect(budget.availableUsd).toBe(1.5);
    expect(second?.settle()).toBe(2);
    expect(budget.spentUsd).toBe(3.5);
  });

  it("waits for temporary reservations before declaring the ceiling reached", async () => {
    const budget = new EvaluationBudget(5, 1);
    const first = budget.reserve(2);
    const second = budget.reserve(2);
    const waiting = budget.reserveWhenAvailable(2);
    first?.settle(0.5);
    second?.settle(0.5);
    const third = await waiting;
    expect(third).not.toBeNull();
    expect(budget.spentUsd).toBe(2);
    third?.settle(0.25);
    expect(budget.spentUsd).toBe(2.25);
    const tail = await budget.reserveWhenAvailable(3);
    expect(tail?.limitUsd).toBe(2.75);
    tail?.settle(2.6);
    expect(await budget.reserveWhenAvailable(3)).toBeNull();
  });

  it("reports every attempted call, including terminal failures", async () => {
    const attempts: number[] = [];
    await expect(retryWithBackoff({
      attempts: 2,
      action: async () => { throw new Error("Evaluator failed (503)"); },
      onAttempt: (attempt) => attempts.push(attempt),
      sleep: async () => undefined,
    })).rejects.toThrow("503");
    expect(attempts).toEqual([1, 2]);
  });

  it("never exceeds the configured worker bound", async () => {
    let active = 0;
    let peak = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    });
    expect(values).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
