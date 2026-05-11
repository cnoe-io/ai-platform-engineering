/**
 * Stage resolver — exhaustive truth table.
 * Pure function, no Mongo/network/env, so we run in jsdom default.
 */
import {
  resolveStage,
  deriveNeedsHuman,
} from "@/lib/agentic-sdlc/stage-resolver";

describe("resolveStage — Rule 1: native terminal states", () => {
  it("merged + sandbox deploy success → deploy", () => {
    expect(
      resolveStage({
        githubState: "merged",
        labels: [],
        sandboxDeploymentState: "success",
      }),
    ).toBe("deploy");
  });

  it("merged + sandbox deploy success + observed signal → observe", () => {
    expect(
      resolveStage({
        githubState: "merged",
        labels: [],
        sandboxDeploymentState: "success",
        observedSignal: true,
      }),
    ).toBe("observe");
  });

  it("merged + deploy failure → blocked", () => {
    expect(
      resolveStage({
        githubState: "merged",
        labels: [],
        sandboxDeploymentState: "failure",
      }),
    ).toBe("blocked");
  });

  it("merged with no deploy yet → merge (interim)", () => {
    expect(
      resolveStage({ githubState: "merged", labels: [] }),
    ).toBe("merge");
  });
});

describe("resolveStage — Rule 2: agent labels", () => {
  it.each([
    ["agent:specify", "specify"],
    ["agent:plan", "plan"],
    ["agent:tasks", "tasks"],
    ["agent:implement", "implement"],
    ["agent:unit-test", "unit_test"],
    ["agent:test", "unit_test"],
    ["agent:awaiting-review", "review_hitl"],
    ["agent:deploy-sandbox", "deploy"],
    ["agent:validate", "validate"],
    ["agent:e2e-test", "validate"],
    ["agent:observe", "observe"],
    ["agent:blocked", "blocked"],
    ["agent:architect", "plan"],
    ["agent:coder", "implement"],
    ["agent:reviewer", "review_hitl"],
    ["agent:tester", "unit_test"],
    ["agent:deployer", "deploy"],
    ["agent:deep-think", "plan"],
    ["status:ready", "tasks"],
    ["status:in-progress", "implement"],
    ["status:blocked", "blocked"],
    ["status:needs-review", "review_hitl"],
    ["status:needs-test", "unit_test"],
    ["status:done", "observe"],
    ["needs:arthur", "blocked"],
    ["needs:decision", "blocked"],
    ["needs:repo-access", "blocked"],
  ])("%s ⇒ %s", (label, expected) => {
    expect(
      resolveStage({ githubState: "open", labels: [label] }),
    ).toBe(expected);
  });

  it("picks the latest-stage label when multiple agent labels are present", () => {
    expect(
      resolveStage({
        githubState: "open",
        labels: ["agent:implement", "agent:unit-test", "agent:awaiting-review"],
      }),
    ).toBe("review_hitl");
  });

  it("honors per-repo label overrides over the default vocab", () => {
    expect(
      resolveStage({
        githubState: "open",
        labels: ["needs-review"],
        labelOverrides: { "needs-review": "review_hitl" },
      }),
    ).toBe("review_hitl");
  });

  it("override that maps to a 'later' stage wins over a default 'earlier' label", () => {
    expect(
      resolveStage({
        githubState: "open",
        labels: ["agent:implement", "ship-it"],
        labelOverrides: { "ship-it": "deploy" },
      }),
    ).toBe("deploy");
  });
});

describe("resolveStage — Rule 3: review_hitl from native PR state", () => {
  it("open PR + reviewers + no agent label ⇒ review_hitl", () => {
    expect(
      resolveStage({
        githubState: "open",
        labels: [],
        hasRequestedReviewers: true,
      }),
    ).toBe("review_hitl");
  });

  it("open PR with no reviewers and no labels ⇒ unknown", () => {
    expect(
      resolveStage({
        githubState: "open",
        labels: [],
        hasRequestedReviewers: false,
      }),
    ).toBe("unknown");
  });
});

describe("resolveStage — Rule 4: default", () => {
  it("falls through to unknown when nothing matches", () => {
    expect(
      resolveStage({ githubState: "closed", labels: [] }),
    ).toBe("unknown");
  });
});

describe("deriveNeedsHuman", () => {
  it("review_hitl with reviewers ⇒ true", () => {
    expect(deriveNeedsHuman("review_hitl", true)).toBe(true);
  });
  it("review_hitl without reviewers ⇒ false", () => {
    expect(deriveNeedsHuman("review_hitl", false)).toBe(false);
  });
  it("blocked ⇒ true regardless of reviewers", () => {
    expect(deriveNeedsHuman("blocked", false)).toBe(true);
  });
  it("any other stage ⇒ false", () => {
    expect(deriveNeedsHuman("implement", true)).toBe(false);
    expect(deriveNeedsHuman("deploy", false)).toBe(false);
  });
});
