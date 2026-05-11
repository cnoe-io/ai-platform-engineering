/**
 * Unit tests for the global Crawl Console dialog.
 *
 * The dialog has three responsibilities the tests pin:
 *
 *   1. Renders the run list, the active run's events, and the
 *      run count footer correctly from store state.
 *   2. Filter chips toggle visibility of the matching event types
 *      WITHOUT removing the bookend events (started + done) --
 *      a "errors only" filter still shows what run we're viewing.
 *   3. Cancel button calls the store's cancelRun for the active
 *      run; Remove button (on a finished run) calls removeRun.
 *
 * We don't exercise the streaming HTTP layer here -- that's
 * crawl-stream-client.test.ts. We mount the dialog with a
 * pre-seeded store and assert what's on screen.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { CrawlConsoleDialog } from "../CrawlConsoleDialog";
import { useCrawlConsoleStore } from "@/store/crawl-console-store";
import type { CrawlEvent } from "@/lib/crawl-events";

beforeEach(() => {
  useCrawlConsoleStore.setState({
    runs: [],
    isOpen: false,
    activeRunId: null,
  });
});

function seedRun(events: CrawlEvent[] = []) {
  const s = useCrawlConsoleStore.getState();
  s.startRun({ id: "r1", label: "Refresh acme/tools", kind: "refresh" });
  for (const e of events) {
    s.appendEvent("r1", e);
  }
}

describe("CrawlConsoleDialog — rendering", () => {
  it("renders nothing when isOpen is false", () => {
    render(<CrawlConsoleDialog />);
    expect(screen.queryByTestId("crawl-console-dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog with run list + active run pane when open", () => {
    seedRun([
      {
        type: "started",
        provider: "gitlab",
        project: "acme/tools",
        api_host: "gitlab.com",
        started_at: "2026-05-05T22:00:00.000Z",
      },
      {
        type: "page",
        page: 1,
        entries: 87,
        has_next: true,
      },
      {
        type: "skill_found",
        path: "skills/foo/SKILL.md",
        name: "foo",
        ancillary_count: 2,
      },
    ]);
    useCrawlConsoleStore.getState().open();
    render(<CrawlConsoleDialog />);

    expect(screen.getByTestId("crawl-console-dialog")).toBeInTheDocument();
    // Several pieces of UI render the label / project — the run
    // list, the header, the started event row. We only need to
    // verify at least one of each is present.
    expect(screen.getAllByText("Refresh acme/tools").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/acme\/tools/).length).toBeGreaterThanOrEqual(1);
    // skill_found event renders the discovered skill.
    expect(screen.getByText(/skills\/foo\/SKILL\.md/)).toBeInTheDocument();
  });
});

describe("CrawlConsoleDialog — filter chips", () => {
  it("hides non-matching events when a filter is active", () => {
    seedRun([
      {
        type: "started",
        provider: "github",
        project: "acme/tools",
        api_host: "api.github.com",
        started_at: "2026-05-05T22:00:00.000Z",
      },
      // Two phases of requests so we can prove the chip works.
      {
        type: "request",
        method: "GET",
        url: "https://api.github.com/repos/x/git/trees/HEAD?recursive=1",
        status: 200,
        duration_ms: 50,
        phase: "tree",
      },
      {
        type: "request",
        method: "GET",
        url: "https://api.github.com/repos/x/contents/skills/y/SKILL.md",
        status: 200,
        duration_ms: 30,
        phase: "skill_md",
      },
    ]);
    useCrawlConsoleStore.getState().open();
    render(<CrawlConsoleDialog />);

    // Both URLs visible by default.
    expect(screen.getByText(/git\/trees\/HEAD/)).toBeInTheDocument();
    expect(screen.getByText(/skills\/y\/SKILL\.md/)).toBeInTheDocument();

    // Toggle the "Tree pages" chip on -- only tree-phase requests
    // should remain (plus the bookend started event, which is
    // never filtered).
    fireEvent.click(screen.getByRole("button", { name: /Tree pages/i }));
    expect(screen.getByText(/git\/trees\/HEAD/)).toBeInTheDocument();
    expect(screen.queryByText(/skills\/y\/SKILL\.md/)).not.toBeInTheDocument();
    // started event is still visible.
    expect(screen.getByText(/started/)).toBeInTheDocument();
  });

  it("'Clear filters' restores the default view", () => {
    seedRun([
      {
        type: "started",
        provider: "github",
        project: "x/y",
        api_host: "api.github.com",
        started_at: "2026-05-05T22:00:00.000Z",
      },
      {
        type: "request",
        method: "GET",
        url: "https://api.github.com/x",
        status: 200,
        duration_ms: 1,
        phase: "skill_md",
      },
    ]);
    useCrawlConsoleStore.getState().open();
    render(<CrawlConsoleDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Tree pages/i }));
    expect(screen.queryByText(/api\.github\.com\/x/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect(screen.getByText(/api\.github\.com\/x/)).toBeInTheDocument();
  });
});

describe("CrawlConsoleDialog — actions", () => {
  it("Cancel button calls cancelRun for the running run", () => {
    seedRun([]);
    useCrawlConsoleStore.getState().open();
    const cancelSpy = jest.spyOn(useCrawlConsoleStore.getState(), "cancelRun");
    render(<CrawlConsoleDialog />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(cancelSpy).toHaveBeenCalledWith("r1");
  });

  it("Remove button (after run finishes) calls removeRun", () => {
    seedRun([]);
    useCrawlConsoleStore.getState().finishRun("r1", "succeeded");
    useCrawlConsoleStore.getState().open();
    const removeSpy = jest.spyOn(useCrawlConsoleStore.getState(), "removeRun");
    render(<CrawlConsoleDialog />);
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/ }));
    expect(removeSpy).toHaveBeenCalledWith("r1");
  });

  it("'Clear finished' calls clearFinished", () => {
    seedRun([]);
    useCrawlConsoleStore.getState().finishRun("r1", "succeeded");
    useCrawlConsoleStore.getState().open();
    const clearSpy = jest.spyOn(
      useCrawlConsoleStore.getState(),
      "clearFinished",
    );
    render(<CrawlConsoleDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Clear finished/i }));
    expect(clearSpy).toHaveBeenCalled();
  });
});
