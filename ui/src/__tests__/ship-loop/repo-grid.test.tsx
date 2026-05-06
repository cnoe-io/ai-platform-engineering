/**
 * @jest-environment jsdom
 *
 * Render-smoke tests for the home-page repo grid + per-repo Epic
 * list. Both components are fetch-driven, so we mock global.fetch
 * and assert on rendered text.
 */
import { render, screen, waitFor } from "@testing-library/react";

import { RepoGrid } from "@/components/ship-loop/RepoGrid";
import { RepoEpicList } from "@/components/ship-loop/RepoEpicList";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RepoGrid", () => {
  it("shows the loading state, then renders one card per repo with counts", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            repo_id: "99000001",
            owner: "demoorg",
            name: "agentic-demo",
            full_name: "demoorg/agentic-demo",
            sandbox_environment: "sandbox-eks",
            webhook_status: "healthy",
            counts: {
              open_epics: 4,
              in_flight_subtasks: 11,
              prs_awaiting_review: 2,
              deploys_24h: 6,
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<RepoGrid />);
    expect(screen.getByText(/loading repos/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("agentic-demo")).toBeInTheDocument(),
    );
    // PRs in review is the only non-zero accent and must be visible.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/sandbox: sandbox-eks/i)).toBeInTheDocument();
  });

  it("renders the empty-state with the seed-script hint when no repos exist", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    }) as unknown as typeof fetch;
    render(<RepoGrid />);
    await waitFor(() =>
      expect(screen.getByText(/no repos onboarded yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/ship-loop:seed-mock-repo/)).toBeInTheDocument();
  });

  it("surfaces the error code with a hint about the no-auth bypass", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    render(<RepoGrid />);
    await waitFor(() =>
      expect(
        screen.getByText(/Could not load onboarded repos \(http_401\)/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/SHIP_LOOP_ALLOW_NO_AUTH=true/)).toBeInTheDocument();
  });
});

describe("RepoEpicList", () => {
  it("loads, then renders Epic rows with counts and needs-human marker", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            artifact_id: "I_42",
            title: "Add OAuth device flow",
            current_stage: "review_hitl",
            needs_human: true,
            stalled_since: null,
            child_counts: { subtasks: 5, prs: 3, deploys: 1 },
            github_url: "https://github.com/demoorg/agentic-demo/issues/42",
            last_event_at: "2026-05-05T20:00:00Z",
          },
        ],
        next_cursor: null,
      }),
    }) as unknown as typeof fetch;

    render(<RepoEpicList owner="demoorg" repo="agentic-demo" />);
    await waitFor(() =>
      expect(screen.getByText("Add OAuth device flow")).toBeInTheDocument(),
    );
    expect(screen.getByText(/5 sub-tasks · 3 PRs · 1 deploys/)).toBeInTheDocument();
    // Two "Needs human" strings exist (filter checkbox label + the
    // row badge). We assert the row badge specifically by the
    // amber-300 colour utility class which only the badge carries.
    const matches = screen.getAllByText(/needs human/i);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(
      matches.some((el) => el.closest("span")?.className.includes("amber")),
    ).toBe(true);
  });

  it("renders an explicit empty state when filters return zero rows", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], next_cursor: null }),
    }) as unknown as typeof fetch;
    render(<RepoEpicList owner="demoorg" repo="agentic-demo" />);
    await waitFor(() =>
      expect(
        screen.getByText(/no epics match the current filters/i),
      ).toBeInTheDocument(),
    );
  });
});
