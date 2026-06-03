/**
 * Pure CI projection tests for `lib/agentic-sdlc/ci-projection.ts`.
 *
 * Exercises:
 *  - isCiEvent / ciEventArtifactId
 *  - normaliseConclusion / normaliseStatus
 *  - mergeCiSummary (worst-conclusion-wins, latest-per-name)
 *  - projectCiEvent end-to-end
 *
 * No Mongo, no network. Pure data in → pure data out.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */
import {
  ciEventArtifactId,
  isCiEvent,
  normaliseConclusion,
  normaliseStatus,
  projectCiEvent,
} from "@/lib/agentic-sdlc/ci-projection";
import type {
  AgenticSdlcArtifact,
  AgenticSdlcEvent,
} from "@/types/agentic-sdlc";

function makeEvent(
  type: "check_run" | "check_suite" | "workflow_run" | "issues",
  payload: Record<string, unknown>,
  overrides: Partial<AgenticSdlcEvent> = {},
): AgenticSdlcEvent {
  return {
    repo_id: "r1",
    source: "github",
    github_delivery_id: "d-1",
    github_event_type: type,
    github_action: null,
    artifact_kind: type === "issues" ? "subtask" : "pull_request",
    artifact_id: "PR_1",
    epic_id: null,
    actor_kind: "system",
    actor_login: null,
    payload,
    delivered_at: new Date("2026-05-22T00:00:00Z"),
    occurred_at: new Date("2026-05-22T00:00:00Z"),
    projection_status: "deferred",
    projection_attempts: 0,
    ...overrides,
  };
}

function makeArtifact(
  overrides: Partial<AgenticSdlcArtifact> = {},
): AgenticSdlcArtifact {
  return {
    repo_id: "r1",
    kind: "pull_request",
    artifact_id: "PR_1",
    epic_id: null,
    parent_subtask_id: null,
    title: "Test PR",
    body_excerpt: "",
    state: "open",
    current_stage: "review_hitl",
    assignees: [],
    requested_reviewers: [],
    labels: [],
    agent_labels: [],
    needs_human: false,
    stalled_since: null,
    last_event_at: new Date("2026-05-22T00:00:00Z"),
    github_url: "https://github.com/o/r/pull/1",
    created_at: new Date("2026-05-22T00:00:00Z"),
    updated_at: new Date("2026-05-22T00:00:00Z"),
    ...overrides,
  };
}

describe("isCiEvent / ciEventArtifactId", () => {
  it("recognises check_run / check_suite / workflow_run", () => {
    expect(isCiEvent(makeEvent("check_run", { check_run: {} }))).toBe(true);
    expect(isCiEvent(makeEvent("check_suite", { check_suite: {} }))).toBe(true);
    expect(isCiEvent(makeEvent("workflow_run", { workflow_run: {} }))).toBe(true);
  });

  it("ignores non-CI events", () => {
    expect(isCiEvent(makeEvent("issues", { issue: {} }))).toBe(false);
  });

  it("returns the PR artifact id for pull-request-linked events", () => {
    const ev = makeEvent("check_run", { check_run: {} });
    expect(ciEventArtifactId(ev)).toBe("PR_1");
  });

  it("returns null when the event isn't a CI event", () => {
    expect(ciEventArtifactId(makeEvent("issues", { issue: {} }))).toBeNull();
  });
});

describe("normaliseConclusion / normaliseStatus", () => {
  it("maps GitHub conclusions to the UI enum", () => {
    expect(normaliseConclusion("success")).toBe("success");
    expect(normaliseConclusion("failure")).toBe("failure");
    expect(normaliseConclusion("startup_failure")).toBe("failure");
    expect(normaliseConclusion("timed_out")).toBe("timed_out");
    expect(normaliseConclusion("skipped")).toBe("skipped");
    expect(normaliseConclusion("neutral")).toBe("neutral");
    expect(normaliseConclusion(null)).toBe("pending");
    expect(normaliseConclusion("something_new")).toBe("unknown");
  });

  it("maps GitHub status to the UI enum", () => {
    expect(normaliseStatus("queued")).toBe("queued");
    expect(normaliseStatus("in_progress")).toBe("in_progress");
    expect(normaliseStatus("completed")).toBe("completed");
    expect(normaliseStatus(undefined)).toBe("completed");
  });
});

describe("projectCiEvent", () => {
  it("returns null when the event has no PR artifact id", () => {
    const ev = makeEvent("workflow_run", { workflow_run: {} }, {
      artifact_kind: "unknown",
      artifact_id: "",
    });
    expect(projectCiEvent(ev, [], null)).toBeNull();
  });

  it("returns null for non-CI events", () => {
    expect(
      projectCiEvent(makeEvent("issues", { issue: {} }), [], makeArtifact()),
    ).toBeNull();
  });

  it("projects a single passing check_run to a success summary", () => {
    const ev = makeEvent("check_run", {
      check_run: {
        id: 123,
        name: "lint",
        status: "completed",
        conclusion: "success",
        head_sha: "abc1234",
        completed_at: "2026-05-22T00:01:00Z",
        details_url: "https://gh.test/lint",
      },
    });
    const patch = projectCiEvent(ev, [], makeArtifact())!;
    expect(patch.artifact_id).toBe("PR_1");
    expect(patch.head_sha).toBe("abc1234");
    expect(patch.ci_summary.conclusion).toBe("success");
    expect(patch.ci_summary.status).toBe("completed");
    expect(patch.ci_summary.total).toBe(1);
    expect(patch.ci_summary.by_conclusion.success).toBe(1);
  });

  it("collapses multiple checks: any failure wins over success", () => {
    const lintPassed = makeEvent("check_run", {
      check_run: {
        id: 1,
        name: "lint",
        status: "completed",
        conclusion: "success",
        head_sha: "abc",
        completed_at: "2026-05-22T00:00:30Z",
      },
    });
    const testsFailed = makeEvent("check_run", {
      check_run: {
        id: 2,
        name: "tests",
        status: "completed",
        conclusion: "failure",
        head_sha: "abc",
        completed_at: "2026-05-22T00:01:00Z",
      },
    });

    const patch = projectCiEvent(testsFailed, [lintPassed], makeArtifact())!;
    expect(patch.ci_summary.total).toBe(2);
    expect(patch.ci_summary.conclusion).toBe("failure");
    expect(patch.ci_summary.by_conclusion.failure).toBe(1);
    expect(patch.ci_summary.by_conclusion.success).toBe(1);
  });

  it("treats an in-progress check as pending, even if other checks passed", () => {
    const lintPassed = makeEvent("check_run", {
      check_run: {
        id: 1,
        name: "lint",
        status: "completed",
        conclusion: "success",
        head_sha: "abc",
        completed_at: "2026-05-22T00:00:30Z",
      },
    });
    const buildRunning = makeEvent("check_run", {
      check_run: {
        id: 2,
        name: "build",
        status: "in_progress",
        conclusion: null,
        head_sha: "abc",
        started_at: "2026-05-22T00:01:00Z",
      },
    });
    const patch = projectCiEvent(buildRunning, [lintPassed], makeArtifact())!;
    expect(patch.ci_summary.status).toBe("in_progress");
    expect(patch.ci_summary.conclusion).toBe("pending");
    expect(patch.ci_summary.by_conclusion.pending).toBe(1);
    expect(patch.ci_summary.by_conclusion.success).toBe(1);
  });

  it("keeps only the latest event per check_name in history", () => {
    const oldFailure = makeEvent(
      "check_run",
      {
        check_run: {
          id: 1,
          name: "tests",
          status: "completed",
          conclusion: "failure",
          head_sha: "abc",
          completed_at: "2026-05-22T00:00:00Z",
        },
      },
      { occurred_at: new Date("2026-05-22T00:00:00Z") },
    );
    const newSuccess = makeEvent(
      "check_run",
      {
        check_run: {
          id: 2,
          name: "tests",
          status: "completed",
          conclusion: "success",
          head_sha: "abc",
          completed_at: "2026-05-22T00:05:00Z",
        },
      },
      { occurred_at: new Date("2026-05-22T00:05:00Z") },
    );
    const patch = projectCiEvent(newSuccess, [oldFailure], makeArtifact())!;
    expect(patch.ci_summary.total).toBe(1);
    expect(patch.ci_summary.conclusion).toBe("success");
    expect(patch.ci_summary.by_conclusion.success).toBe(1);
    expect(patch.ci_summary.by_conclusion.failure).toBeUndefined();
  });

  it("projects workflow_run events the same way", () => {
    const ev = makeEvent("workflow_run", {
      workflow_run: {
        id: 999,
        name: "CI",
        status: "completed",
        conclusion: "success",
        head_sha: "deadbeef",
        run_started_at: "2026-05-22T00:00:00Z",
        updated_at: "2026-05-22T00:01:30Z",
        html_url: "https://gh.test/run/999",
      },
    });
    const patch = projectCiEvent(ev, [], makeArtifact())!;
    expect(patch.ci_summary.conclusion).toBe("success");
    expect(patch.head_sha).toBe("deadbeef");
  });
});
