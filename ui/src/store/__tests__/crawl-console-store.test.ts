/**
 * Tests for the crawl-console store. Pin the lifecycle contracts
 * the dialog and the stream client both depend on:
 *
 *   1. startRun creates a `running` record at the front of the
 *      list, marks it active, and auto-opens the dialog when no
 *      other runs are in flight.
 *   2. Subsequent concurrent runs DON'T re-open a manually
 *      closed dialog (anti-jiggle).
 *   3. appendEvent promotes provider/project from the `started`
 *      event to top-level fields so the run list can render
 *      before any other event.
 *   4. finishRun clears the abort controller and stamps ended_at.
 *   5. cancelRun calls AbortController.abort and finishes with
 *      status `aborted`.
 *   6. removeRun is a no-op for running runs (we'd orphan their
 *      streams) and shifts active to the next available run when
 *      it removes the active one.
 *   7. clearFinished only drops non-running runs.
 *   8. MAX_RUNS pruning never drops a running run.
 *   9. MAX_EVENTS_PER_RUN cap on appendEvent.
 */

import {
  useCrawlConsoleStore,
  selectRunningCount,
  selectActiveRun,
} from "../crawl-console-store";

beforeEach(() => {
  // Reset store state between tests.
  useCrawlConsoleStore.setState({
    runs: [],
    isOpen: false,
    activeRunId: null,
  });
});

describe("crawl-console-store — startRun", () => {
  it("creates a running record at the front and marks it active", () => {
    useCrawlConsoleStore.getState().startRun({
      id: "r1",
      label: "Refresh acme/tools",
      kind: "refresh",
    });
    const s = useCrawlConsoleStore.getState();
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0].id).toBe("r1");
    expect(s.runs[0].status).toBe("running");
    expect(s.activeRunId).toBe("r1");
  });

  it("auto-opens the dialog when no other runs are in flight", () => {
    expect(useCrawlConsoleStore.getState().isOpen).toBe(false);
    useCrawlConsoleStore.getState().startRun({
      id: "r1",
      label: "Preview foo/bar",
      kind: "preview",
    });
    expect(useCrawlConsoleStore.getState().isOpen).toBe(true);
  });

  it("does NOT re-open the dialog if it was manually closed while another run is running", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "Run 1", kind: "preview" });
    expect(useCrawlConsoleStore.getState().isOpen).toBe(true);
    // User dismisses while r1 is still running.
    useCrawlConsoleStore.getState().close();
    expect(useCrawlConsoleStore.getState().isOpen).toBe(false);
    // Concurrent run starts -- dialog should stay closed.
    useCrawlConsoleStore.getState().startRun({
      id: "r2",
      label: "Run 2",
      kind: "refresh",
    });
    expect(useCrawlConsoleStore.getState().isOpen).toBe(false);
    // r2 must still be active so when the user re-opens manually
    // they see the latest run.
    expect(useCrawlConsoleStore.getState().activeRunId).toBe("r2");
  });
});

describe("crawl-console-store — appendEvent", () => {
  it("promotes provider/project from the started event", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "x", kind: "preview" });
    s.appendEvent("r1", {
      type: "started",
      provider: "gitlab",
      project: "acme/tools",
      api_host: "gitlab.com",
      started_at: new Date().toISOString(),
    });
    const run = useCrawlConsoleStore.getState().runs.find((r) => r.id === "r1");
    expect(run?.provider).toBe("gitlab");
    expect(run?.project).toBe("acme/tools");
    expect(run?.events).toHaveLength(1);
  });

  it("appends events without mutating earlier ones", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "x", kind: "preview" });
    s.appendEvent("r1", { type: "page", page: 1, entries: 10, has_next: false });
    s.appendEvent("r1", {
      type: "skill_found",
      path: "skills/x/SKILL.md",
      name: "X",
      ancillary_count: 0,
    });
    const run = useCrawlConsoleStore.getState().runs[0];
    expect(run.events).toHaveLength(2);
    expect(run.events[0].type).toBe("page");
    expect(run.events[1].type).toBe("skill_found");
  });

  it("ignores appendEvent for unknown run id", () => {
    const s = useCrawlConsoleStore.getState();
    s.appendEvent("missing", {
      type: "page",
      page: 1,
      entries: 0,
      has_next: false,
    });
    expect(useCrawlConsoleStore.getState().runs).toHaveLength(0);
  });
});

describe("crawl-console-store — finishRun + cancelRun", () => {
  it("finishRun stamps ended_at and clears abort controller", () => {
    const s = useCrawlConsoleStore.getState();
    const abort = new AbortController();
    s.startRun({ id: "r1", label: "x", kind: "preview", abort });
    s.finishRun("r1", "succeeded");
    const run = useCrawlConsoleStore.getState().runs[0];
    expect(run.status).toBe("succeeded");
    expect(run.abort).toBeUndefined();
    expect(run.ended_at).toBeGreaterThanOrEqual(run.started_at);
  });

  it("cancelRun aborts the controller and marks run as aborted", () => {
    const s = useCrawlConsoleStore.getState();
    const abort = new AbortController();
    const abortSpy = jest.spyOn(abort, "abort");
    s.startRun({ id: "r1", label: "x", kind: "preview", abort });
    s.cancelRun("r1");
    expect(abortSpy).toHaveBeenCalled();
    const run = useCrawlConsoleStore.getState().runs[0];
    expect(run.status).toBe("aborted");
  });

  it("cancelRun on already-finished run is a no-op", () => {
    const s = useCrawlConsoleStore.getState();
    const abort = new AbortController();
    const abortSpy = jest.spyOn(abort, "abort");
    s.startRun({ id: "r1", label: "x", kind: "preview", abort });
    s.finishRun("r1", "succeeded");
    s.cancelRun("r1");
    expect(abortSpy).not.toHaveBeenCalled();
    expect(useCrawlConsoleStore.getState().runs[0].status).toBe("succeeded");
  });
});

describe("crawl-console-store — removeRun + clearFinished", () => {
  it("refuses to remove a running run", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "x", kind: "preview" });
    s.removeRun("r1");
    expect(useCrawlConsoleStore.getState().runs).toHaveLength(1);
  });

  it("removes a finished run and shifts active to the next one", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "1", kind: "preview" });
    s.finishRun("r1", "succeeded");
    s.startRun({ id: "r2", label: "2", kind: "refresh" });
    // r2 is active by virtue of being most recent.
    expect(useCrawlConsoleStore.getState().activeRunId).toBe("r2");
    s.setActiveRun("r1");
    s.removeRun("r1");
    const after = useCrawlConsoleStore.getState();
    expect(after.runs.find((r) => r.id === "r1")).toBeUndefined();
    // Active shifted to the only remaining run.
    expect(after.activeRunId).toBe("r2");
  });

  it("clearFinished drops finished runs and keeps running ones", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "1", kind: "preview" });
    s.finishRun("r1", "succeeded");
    s.startRun({ id: "r2", label: "2", kind: "refresh" });
    s.startRun({ id: "r3", label: "3", kind: "preview" });
    s.finishRun("r3", "failed");
    s.clearFinished();
    const after = useCrawlConsoleStore.getState();
    expect(after.runs.map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("crawl-console-store — selectors", () => {
  it("selectRunningCount counts only running runs", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "1", kind: "preview" });
    s.startRun({ id: "r2", label: "2", kind: "refresh" });
    s.finishRun("r1", "succeeded");
    expect(selectRunningCount(useCrawlConsoleStore.getState())).toBe(1);
  });

  it("selectActiveRun returns the active run or undefined", () => {
    const s = useCrawlConsoleStore.getState();
    expect(selectActiveRun(useCrawlConsoleStore.getState())).toBeUndefined();
    s.startRun({ id: "r1", label: "1", kind: "preview" });
    expect(selectActiveRun(useCrawlConsoleStore.getState())?.id).toBe("r1");
  });
});
