/**
 * Tests for the admin-header status pill. Pin the visibility
 * matrix:
 *
 *   - 0 runs total -> hidden (no permanent "0 crawls" chip).
 *   - >=1 running -> "{n} running" with pulse animation hint.
 *   - 0 running, >=1 finished -> "{n} recent" without pulse.
 *
 * The pulse is verified via the animate-pulse class on the icon;
 * we don't assert the actual CSS animation, only that the right
 * marker class is present.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { CrawlConsoleHeaderPill } from "../CrawlConsoleHeaderPill";
import { useCrawlConsoleStore } from "@/store/crawl-console-store";

beforeEach(() => {
  useCrawlConsoleStore.setState({
    runs: [],
    isOpen: false,
    activeRunId: null,
  });
});

describe("CrawlConsoleHeaderPill", () => {
  it("hides itself when no runs have happened", () => {
    render(<CrawlConsoleHeaderPill />);
    expect(
      screen.queryByTestId("crawl-console-header-pill"),
    ).not.toBeInTheDocument();
  });

  it("shows running label and pulse when at least one run is in flight", () => {
    useCrawlConsoleStore
      .getState()
      .startRun({ id: "r1", label: "x", kind: "preview" });
    render(<CrawlConsoleHeaderPill />);
    const pill = screen.getByTestId("crawl-console-header-pill");
    expect(pill).toHaveTextContent("1 crawl running");
    // Pulse marker class on the icon (lucide renders an SVG inside
    // the button).
    expect(pill.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows recent label without pulse when only finished runs exist", () => {
    const s = useCrawlConsoleStore.getState();
    s.startRun({ id: "r1", label: "x", kind: "preview" });
    s.finishRun("r1", "succeeded");
    render(<CrawlConsoleHeaderPill />);
    const pill = screen.getByTestId("crawl-console-header-pill");
    expect(pill).toHaveTextContent("1 recent crawl");
    expect(pill.querySelector(".animate-pulse")).toBeNull();
  });

  it("opens the dialog when clicked", () => {
    useCrawlConsoleStore
      .getState()
      .startRun({ id: "r1", label: "x", kind: "preview" });
    // The auto-open already fired; close to set up the test state.
    useCrawlConsoleStore.getState().close();
    expect(useCrawlConsoleStore.getState().isOpen).toBe(false);
    render(<CrawlConsoleHeaderPill />);
    fireEvent.click(screen.getByTestId("crawl-console-header-pill"));
    expect(useCrawlConsoleStore.getState().isOpen).toBe(true);
  });
});
