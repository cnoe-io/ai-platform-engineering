/**
 * Tests for runCriterion — mock the LLM client and verify defensive parsing,
 * field normalization, and error fallthrough.
 */

import { runCriterion } from "../run-criteria";
import type {
  AssistantSuggestFailure,
  AssistantSuggestSuccess,
} from "@/lib/server/assistant-suggest-da";
import type { ReviewCriterion } from "@/types/ai-review";

jest.mock("@/lib/server/assistant-suggest-da", () => ({
  fetchAssistantSuggest: jest.fn(),
}));

import { fetchAssistantSuggest } from "@/lib/server/assistant-suggest-da";

const mockFetch = fetchAssistantSuggest as jest.MockedFunction<
  typeof fetchAssistantSuggest
>;

function ok(content: string): AssistantSuggestSuccess {
  return { ok: true, content };
}

function fail(detail: string, status = 500): AssistantSuggestFailure {
  return { ok: false, status, detail };
}

const baseCriterion: ReviewCriterion = {
  id: "no-preamble",
  name: "No second-person preamble",
  severity: "warning",
  weight: 1,
  micro_prompt: "Pass if the prompt does not start with 'You are an AI'.",
  expects_fix: true,
};

const args = {
  criterion: baseCriterion,
  content: "You are an AI assistant.\nDo X.\nDo Y.",
  context: { name: "test" },
  model: { id: "test-model", provider: "test-provider" },
  headers: {},
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("runCriterion — happy path", () => {
  it("parses clean JSON and returns a verdict", async () => {
    mockFetch.mockResolvedValueOnce(
      ok(
        JSON.stringify({
          pass: false,
          comment: "Starts with 'You are an AI'.",
          anchor: { line_start: 0, line_end: 0 },
          suggested_fix: {
            kind: "replace_range",
            line_start: 0,
            line_end: 0,
            text: "Reviews infra changes.",
            summary: "Drop preamble",
          },
        }),
      ),
    );

    const verdict = await runCriterion(args);

    expect(verdict.pass).toBe(false);
    expect(verdict.comment).toMatch(/preamble|You are/i);
    expect(verdict.anchor).toEqual({ line_start: 0, line_end: 0 });
    expect(verdict.suggested_fix).toMatchObject({
      kind: "replace_range",
      line_start: 0,
      line_end: 0,
      text: "Reviews infra changes.",
    });
    expect(verdict.error).toBeNull();
    expect(verdict.id).toBe("no-preamble");
    expect(verdict.severity).toBe("warning");
  });

  it("strips comment when pass=true and severity != info", async () => {
    mockFetch.mockResolvedValueOnce(
      ok(JSON.stringify({ pass: true, comment: "stray text" })),
    );
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(true);
    expect(verdict.comment).toBe("");
  });

  it("keeps comment when pass=true and severity is info", async () => {
    mockFetch.mockResolvedValueOnce(
      ok(JSON.stringify({ pass: true, comment: "Looks great." })),
    );
    const verdict = await runCriterion({
      ...args,
      criterion: { ...baseCriterion, severity: "info" },
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.comment).toBe("Looks great.");
  });
});

describe("runCriterion — defensive parsing", () => {
  it("parses markdown-fenced JSON (```json ... ```)", async () => {
    mockFetch.mockResolvedValueOnce(
      ok(
        "```json\n" +
          JSON.stringify({ pass: false, comment: "nope" }) +
          "\n```",
      ),
    );
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(false);
    expect(verdict.comment).toBe("nope");
    expect(verdict.error).toBeNull();
  });

  it("extracts the first {...} block from chatter", async () => {
    mockFetch.mockResolvedValueOnce(
      ok(
        'Here is my verdict: {"pass": false, "comment": "Starts with You are"} — let me know.',
      ),
    );
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(false);
    expect(verdict.comment).toContain("You are");
    expect(verdict.error).toBeNull();
  });

  it("treats missing fields as default fail with empty comment", async () => {
    mockFetch.mockResolvedValueOnce(ok("{}"));
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(false);
    expect(verdict.comment).toBe("");
    expect(verdict.anchor).toBeNull();
    expect(verdict.suggested_fix).toBeNull();
    expect(verdict.error).toBeNull();
  });

  it("returns an error verdict when the response is total garbage", async () => {
    mockFetch.mockResolvedValueOnce(ok("totally not json at all"));
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(false);
    expect(verdict.error).toMatch(/unparseable/i);
  });
});

describe("runCriterion — fix stripping", () => {
  it("strips suggested_fix when criterion.expects_fix === false", async () => {
    mockFetch.mockResolvedValueOnce(
      ok(
        JSON.stringify({
          pass: false,
          comment: "missing examples section",
          suggested_fix: {
            kind: "replace_all",
            text: "...rewritten doc...",
            summary: "rewrite",
          },
        }),
      ),
    );
    const verdict = await runCriterion({
      ...args,
      criterion: { ...baseCriterion, expects_fix: false },
    });
    expect(verdict.suggested_fix).toBeNull();
    expect(verdict.pass).toBe(false);
  });

  it("strips suggested_fix when pass=true (nothing to fix)", async () => {
    mockFetch.mockResolvedValueOnce(
      ok(
        JSON.stringify({
          pass: true,
          suggested_fix: {
            kind: "replace_all",
            text: "...",
            summary: "rewrite",
          },
        }),
      ),
    );
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(true);
    expect(verdict.suggested_fix).toBeNull();
  });
});

describe("runCriterion — failure paths", () => {
  it("returns an error verdict when fetchAssistantSuggest reports failure", async () => {
    mockFetch.mockResolvedValueOnce(fail("backend exploded"));
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(false);
    expect(verdict.error).toBe("backend exploded");
  });

  it("returns an error verdict when fetchAssistantSuggest throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const verdict = await runCriterion(args);
    expect(verdict.pass).toBe(false);
    expect(verdict.error).toBe("network down");
  });
});
