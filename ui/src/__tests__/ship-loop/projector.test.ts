/**
 * Pure projection tests for the async worker's `projectEvent`.
 *
 * The worker's queue/persistence side requires Mongo and is exercised
 * via integration tests; the projection function itself is pure over
 * (event, repo) and we cover it here.
 */
import {
  buildArtifactUpsert,
  projectEvent,
} from "@/lib/ship-loop/projector";
import type {
  OnboardedRepo,
  ShipLoopEvent,
} from "@/types/ship-loop";

function makeRepo(overrides: Partial<OnboardedRepo> = {}): OnboardedRepo {
  return {
    repo_id: "1",
    owner: "acme",
    name: "demo",
    full_name: "acme/demo",
    default_branch: "main",
    sandbox_environment: "sandbox",
    webhook_id: 99,
    webhook_secret_hash: "h",
    webhook_status: "healthy",
    webhook_last_event_at: null,
    label_to_stage_overrides: {},
    onboarded_by_user_id: "u1",
    onboarded_at: new Date(),
    offboarded_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  overrides: Partial<ShipLoopEvent> = {},
): ShipLoopEvent {
  return {
    repo_id: "1",
    source: "github",
    github_delivery_id: "d-1",
    github_event_type: type,
    github_action: null,
    artifact_kind: "unknown",
    artifact_id: "node-1",
    epic_id: null,
    actor_kind: "system",
    actor_login: null,
    payload,
    delivered_at: new Date(),
    occurred_at: new Date(),
    projection_status: "deferred",
    projection_attempts: 0,
    ...overrides,
  };
}

describe("projectEvent — pull_request", () => {
  it("projects an open PR with reviewers to review_hitl", () => {
    const ev = makeEvent("pull_request", {
      pull_request: {
        node_id: "PR_1",
        title: "Add login",
        body: "ref #123",
        state: "open",
        merged: false,
        labels: [],
        requested_reviewers: [{ login: "alice" }],
        assignees: [],
        html_url: "https://github.com/acme/demo/pull/1",
      },
    });
    const out = projectEvent(ev, makeRepo());
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("pull_request");
    expect(out!.current_stage).toBe("review_hitl");
    expect(out!.requested_reviewers).toEqual(["alice"]);
    expect(out!.needs_human).toBe(true);
  });

  it("projects a merged PR with no deploy info to merge stage", () => {
    const ev = makeEvent("pull_request", {
      pull_request: {
        node_id: "PR_2",
        title: "x",
        body: "",
        state: "closed",
        merged: true,
        labels: [],
        requested_reviewers: [],
        assignees: [],
        html_url: "u",
      },
    });
    const out = projectEvent(ev, makeRepo())!;
    expect(out.state).toBe("merged");
    expect(out.current_stage).toBe("merge");
    expect(out.needs_human).toBe(false);
  });

  it("respects per-repo label overrides", () => {
    const ev = makeEvent("pull_request", {
      pull_request: {
        node_id: "PR_3",
        title: "x",
        body: "",
        state: "open",
        merged: false,
        labels: [{ name: "ship-it" }],
        requested_reviewers: [],
        assignees: [],
        html_url: "u",
      },
    });
    const out = projectEvent(
      ev,
      makeRepo({ label_to_stage_overrides: { "ship-it": "deploy" } }),
    )!;
    expect(out.current_stage).toBe("deploy");
  });
});

describe("projectEvent — issues", () => {
  it("classifies issues with `epic` label as kind=epic", () => {
    const ev = makeEvent("issues", {
      issue: {
        node_id: "I_1",
        title: "Big idea",
        body: "",
        state: "open",
        labels: [{ name: "epic" }, { name: "agent:plan" }],
        assignees: [],
        html_url: "u",
      },
    });
    const out = projectEvent(ev, makeRepo())!;
    expect(out.kind).toBe("epic");
    expect(out.current_stage).toBe("plan");
  });

  it("classifies un-labeled issues as kind=subtask, stage unknown", () => {
    const ev = makeEvent("issues", {
      issue: {
        node_id: "I_2",
        title: "small bug",
        body: "",
        state: "open",
        labels: [],
        assignees: [],
        html_url: "u",
      },
    });
    const out = projectEvent(ev, makeRepo())!;
    expect(out.kind).toBe("subtask");
    expect(out.current_stage).toBe("unknown");
  });
});

describe("projectEvent — deployment_status", () => {
  it("projects sandbox deploy success → deploy stage", () => {
    const ev = makeEvent("deployment_status", {
      deployment: {
        node_id: "D_1",
        environment: "sandbox",
      },
      deployment_status: {
        state: "success",
        description: "deployed",
        target_url: "https://sandbox/app",
      },
    });
    const out = projectEvent(ev, makeRepo())!;
    expect(out.kind).toBe("deploy");
    expect(out.current_stage).toBe("deploy");
    expect(out.state).toBe("success");
  });

  it("projects sandbox deploy failure → blocked stage", () => {
    const ev = makeEvent("deployment_status", {
      deployment: {
        node_id: "D_2",
        environment: "sandbox",
      },
      deployment_status: { state: "failure", description: "boom" },
    });
    const out = projectEvent(ev, makeRepo())!;
    expect(out.current_stage).toBe("blocked");
    expect(out.needs_human).toBe(true);
  });

  it("ignores deploys to non-sandbox envs", () => {
    const ev = makeEvent("deployment_status", {
      deployment: { node_id: "D_3", environment: "production" },
      deployment_status: { state: "success" },
    });
    const out = projectEvent(ev, makeRepo({ sandbox_environment: "sandbox" }));
    expect(out).toBeNull();
  });
});

describe("projectEvent — unmodelled events", () => {
  it("returns null for pull_request_review (timeline-only)", () => {
    expect(
      projectEvent(makeEvent("pull_request_review", {}), makeRepo()),
    ).toBeNull();
  });
  it("returns null for unrecognised event types", () => {
    expect(
      projectEvent(makeEvent("watch", {}), makeRepo()),
    ).toBeNull();
  });
});

/**
 * Regression test for the upsert-conflict bug surfaced by the
 * end-to-end smoke against a live Mongo instance: if `$set` and
 * `$setOnInsert` ever touch the same field paths, every artifact
 * upsert fails with `MongoError: Updating the path 'X' would create
 * a conflict at 'X'` and projector.failed events accumulate silently.
 */
describe("buildArtifactUpsert — Mongo path-conflict invariant", () => {
  function patch() {
    const ev = makeEvent("pull_request", {
      pull_request: {
        node_id: "PR_1",
        title: "x",
        body: "",
        state: "open",
        merged: false,
        labels: [],
        requested_reviewers: [],
        assignees: [],
        html_url: "u",
      },
    });
    const p = projectEvent(ev, makeRepo());
    if (!p) throw new Error("expected non-null patch");
    return p;
  }

  it("$set and $setOnInsert never share a field path", () => {
    const update = buildArtifactUpsert(patch(), new Date(), new Date());
    const setKeys = Object.keys(update.$set);
    const insertKeys = Object.keys(update.$setOnInsert);
    const overlap = setKeys.filter((k) => insertKeys.includes(k));
    expect(overlap).toEqual([]);
  });

  it("$set carries every field of the projected patch (so the artifact is fully written)", () => {
    const p = patch();
    const update = buildArtifactUpsert(p, new Date(), new Date());
    for (const key of Object.keys(p)) {
      expect(update.$set).toHaveProperty(key);
    }
  });

  it("$setOnInsert only carries fields that should not change after creation", () => {
    const update = buildArtifactUpsert(patch(), new Date(), new Date());
    expect(Object.keys(update.$setOnInsert).sort()).toEqual(["created_at"]);
  });

  it("includes last_event_at and updated_at on $set", () => {
    const occurred = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-05-06T13:00:00Z");
    const update = buildArtifactUpsert(patch(), occurred, now);
    expect(update.$set.last_event_at).toBe(occurred);
    expect(update.$set.updated_at).toBe(now);
  });
});
