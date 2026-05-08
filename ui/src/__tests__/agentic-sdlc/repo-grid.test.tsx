/**
 * @jest-environment jsdom
 *
 * Render-smoke tests for the home-page repo grid + per-repo Epic
 * list. Both components are fetch-driven, so we mock global.fetch
 * and assert on rendered text.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RepoGrid } from "@/components/agentic-sdlc/RepoGrid";
import { RepoDetailShell } from "@/components/agentic-sdlc/RepoDetailShell";
import { RepoEpicList } from "@/components/agentic-sdlc/RepoEpicList";
import { useFeatureFlagStore } from "@/store/feature-flag-store";

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
  useFeatureFlagStore.setState((state) => ({
    flags: { ...state.flags, shipLoopSimulation: false },
  }));
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
    expect(screen.getByText("agentic-demo").closest("a")).toHaveAttribute(
      "href",
      "/apps/agentic-sdlc/demoorg/agentic-demo",
    );
  });

  it("asks the user to onboard a new repo when no repos exist", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    }) as unknown as typeof fetch;
    render(<RepoGrid />);
    await waitFor(() =>
      expect(screen.getByText(/no repos onboarded yet/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /open repo onboarding wizard/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ship-loop:seed-mock-repo/)).not.toBeInTheDocument();
  });

  it("refreshes when the onboarding wizard announces a new repo", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              repo_id: "123456",
              owner: "acme",
              name: "real-repo",
              full_name: "acme/real-repo",
              sandbox_environment: "sandbox-eks",
              webhook_status: "healthy",
              counts: {
                open_epics: 0,
                in_flight_subtasks: 0,
                prs_awaiting_review: 0,
                deploys_24h: 0,
              },
            },
          ],
        }),
      }) as unknown as typeof fetch;

    render(<RepoGrid />);
    await waitFor(() =>
      expect(screen.getByText(/no repos onboarded yet/i)).toBeInTheDocument(),
    );

    window.dispatchEvent(new CustomEvent("ship-loop:repo-onboarded"));

    await waitFor(() =>
      expect(screen.getByText("real-repo")).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes when the portfolio live stream announces repo activity", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              repo_id: "123456",
              owner: "acme",
              name: "live-repo",
              full_name: "acme/live-repo",
              sandbox_environment: "sandbox-eks",
              webhook_status: "healthy",
              counts: {
                open_epics: 1,
                in_flight_subtasks: 2,
                prs_awaiting_review: 0,
                deploys_24h: 0,
              },
            },
          ],
        }),
      }) as unknown as typeof fetch;

    render(<RepoGrid />);
    await waitFor(() =>
      expect(screen.getByText(/no repos onboarded yet/i)).toBeInTheDocument(),
    );

    window.dispatchEvent(
      new CustomEvent("agentic-sdlc:portfolio-synced", {
        detail: { repo_id: "123456" },
      }),
    );

    await waitFor(() => expect(screen.getByText("live-repo")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
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

  it("lets the user favorite a repo from the repo tiles view", async () => {
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
    const favoriteButton = await screen.findByRole("button", {
      name: /favorite demoorg\/agentic-demo/i,
    });

    fireEvent.click(favoriteButton);

    expect(favoriteButton).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("agentic-sdlc-starred-repos")).toBe(
      JSON.stringify(["demoorg/agentic-demo"]),
    );
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
    expect(screen.getByText("Add OAuth device flow").closest("a")).toHaveAttribute(
      "href",
      "/apps/agentic-sdlc/demoorg/agentic-demo/epics/I_42",
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

  it("refreshes when a repo simulation is seeded", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              artifact_id: "SIM_EPIC_AGENTIC_SPA",
              title: "Epic: Agentic SDLC simulation mode",
              current_stage: "review_hitl",
              needs_human: true,
              stalled_since: null,
              child_counts: { subtasks: 2, prs: 1, deploys: 1 },
              github_url: "https://github.com/demoorg/agentic-demo/issues/901",
              last_event_at: "2026-05-05T20:00:00Z",
            },
          ],
          next_cursor: null,
        }),
      }) as unknown as typeof fetch;

    render(<RepoEpicList owner="demoorg" repo="agentic-demo" />);
    await waitFor(() =>
      expect(
        screen.getByText(/no epics match the current filters/i),
      ).toBeInTheDocument(),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ship-loop:simulation-seeded", {
          detail: { owner: "demoorg", repo: "agentic-demo" },
        }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText("Epic: Agentic SDLC simulation mode"),
      ).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("RepoDetailShell", () => {
  it("lets the user reconcile repo state from GitHub when webhooks were missed", async () => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sync")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            synced: true,
            repo: "demoorg/agentic-demo",
            artifacts_upserted: 3,
            events_recorded: 3,
            last_reconciled_at: "2026-05-07T08:30:00.000Z",
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          counts: {
            open_epics: 0,
            in_flight_subtasks: 0,
            prs_awaiting_review: 0,
            deploys_24h: 0,
          },
          activity_24h: 0,
          stage_counts: [],
          human_queue: { needs_human_count: 0, oldest_waiting_since: null, items: [] },
          swim_lanes: [],
          items: [],
          next_cursor: null,
        }),
      } as Response);
    }) as unknown as typeof fetch;

    render(<RepoDetailShell owner="demoorg" repo="agentic-demo" />);
    const refresh = await screen.findByRole("button", {
      name: /refresh from github/i,
    });

    fireEvent.click(refresh);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/agentic-sdlc/repos/demoorg/agentic-demo/sync",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByText(/synced 3 artifacts from github/i),
    ).toBeInTheDocument();
  });

  it("renders the repo command center with swim lanes and Epic drilldown", async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/epics") && !url.includes("/simulate")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            counts: {
              open_epics: 2,
              in_flight_subtasks: 4,
              prs_awaiting_review: 1,
              deploys_24h: 3,
            },
            activity_24h: 9,
            stage_counts: [
              { stage: "specify", count: 1 },
              { stage: "tasks", count: 4 },
              { stage: "review_hitl", count: 1 },
            ],
            human_queue: {
              needs_human_count: 1,
              oldest_waiting_since: "2026-05-05T20:00:00Z",
              items: [
                {
                  artifact_id: "PR_42",
                  kind: "pull_request",
                  title: "Review OAuth PR",
                  current_stage: "review_hitl",
                  github_url: "https://github.com/demoorg/agentic-demo/pull/42",
                  last_event_at: "2026-05-05T20:00:00Z",
                },
              ],
            },
            swim_lanes: [
              {
                stage: "specify",
                items: [
                  {
                    artifact_id: "I_2",
                    kind: "epic",
                    title: "Create an SDLC Dashboard",
                    current_stage: "specify",
                    actor_kind: "agent",
                    github_url: "https://github.com/demoorg/agentic-demo/issues/2",
                    last_event_at: "2026-05-05T20:00:00Z",
                  },
                ],
              },
              {
                stage: "review_hitl",
                items: [
                  {
                    artifact_id: "PR_42",
                    kind: "pull_request",
                    title: "Review OAuth PR",
                    current_stage: "review_hitl",
                    actor_kind: "human",
                    github_url: "https://github.com/demoorg/agentic-demo/pull/42",
                    last_event_at: "2026-05-05T20:00:00Z",
                  },
                ],
              },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({
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
      } as Response);
    }) as unknown as typeof fetch;

    render(<RepoDetailShell owner="demoorg" repo="agentic-demo" />);

    expect(screen.getByText(/repo detail view/i)).toBeInTheDocument();
    expect(screen.queryByText(/loop state/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/receiver/i)).not.toBeInTheDocument();
    expect(screen.getByText(/live repo swim lanes/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /swim lanes/i })).toBeInTheDocument();
    expect(await screen.findByText("Create an SDLC Dashboard")).toBeInTheDocument();
    expect(screen.queryByText(/wire skills middleware/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approve pr #482/i)).not.toBeInTheDocument();
    expect(screen.getByText(/repo operating graph/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/placeholder for repo velocity/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /run simulation/i }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    expect(screen.getByText(/open epics/i)).toBeInTheDocument();
    expect(screen.getByText(/9 events in the last 24h/i)).toBeInTheDocument();
    expect(screen.getAllByText("Review OAuth PR").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByText("Add OAuth device flow")).toBeInTheDocument(),
    );
  });

  it("does not render an Unknown swim lane for unlabeled reconciled issues", async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/epics")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            counts: {
              open_epics: 1,
              in_flight_subtasks: 1,
              prs_awaiting_review: 0,
              deploys_24h: 0,
            },
            activity_24h: 2,
            stage_counts: [
              { stage: "unknown", count: 1 },
              { stage: "specify", count: 1 },
            ],
            human_queue: {
              needs_human_count: 0,
              oldest_waiting_since: null,
              items: [],
            },
            swim_lanes: [
              {
                stage: "unknown",
                items: [
                  {
                    artifact_id: "I_unlabeled",
                    kind: "subtask",
                    title: "[Task] Configure global state management stub",
                    current_stage: "unknown",
                    actor_kind: "system",
                    github_url: "https://github.com/demoorg/agentic-demo/issues/1",
                    last_event_at: "2026-05-07T08:00:00Z",
                  },
                ],
              },
              {
                stage: "specify",
                items: [
                  {
                    artifact_id: "I_epic",
                    kind: "epic",
                    title: "Refactor react app to be template app",
                    current_stage: "specify",
                    actor_kind: "agent",
                    github_url: "https://github.com/demoorg/agentic-demo/issues/2",
                    last_event_at: "2026-05-07T08:01:00Z",
                  },
                ],
              },
            ],
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [], next_cursor: null }),
      } as Response);
    }) as unknown as typeof fetch;

    render(<RepoDetailShell owner="demoorg" repo="agentic-demo" />);

    await waitFor(() =>
      expect(
        screen.getByText("Refactor react app to be template app"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText("[Task] Configure global state management stub"),
    ).not.toBeInTheDocument();
  });

  it("triggers the local simulation from the repo detail view", async () => {
    useFeatureFlagStore.setState((state) => ({
      flags: { ...state.flags, shipLoopSimulation: true },
    }));

    let epicCallCount = 0;
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/simulate")) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            simulated: true,
            repo: "demoorg/agentic-demo",
            epic_id: "SIM_EPIC_AGENTIC_SPA",
            artifacts_created: 5,
            events_created: 6,
            message: "Seeded",
          }),
        } as Response);
      }

      if (!url.includes("/epics")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            counts: {
              open_epics: 0,
              in_flight_subtasks: 0,
              prs_awaiting_review: 0,
              deploys_24h: 0,
            },
            activity_24h: 0,
            stage_counts: [],
            human_queue: {
              needs_human_count: 0,
              oldest_waiting_since: null,
              items: [],
            },
            swim_lanes: [],
          }),
        } as Response);
      }

      epicCallCount += 1;
      if (epicCallCount === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_cursor: null }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              artifact_id: "SIM_EPIC_AGENTIC_SPA",
              title: "Epic: Agentic SDLC simulation mode",
              current_stage: "review_hitl",
              needs_human: true,
              stalled_since: null,
              child_counts: { subtasks: 2, prs: 1, deploys: 1 },
              github_url: "https://github.com/demoorg/agentic-demo/issues/901",
              last_event_at: "2026-05-05T20:00:00Z",
            },
          ],
          next_cursor: null,
        }),
      } as Response);
    }) as unknown as typeof fetch;

    render(<RepoDetailShell owner="demoorg" repo="agentic-demo" />);
    await waitFor(() =>
      expect(
        screen.getByText(/no epics match the current filters/i),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() =>
      expect(screen.getByText(/simulation seeded/i)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Epic: Agentic SDLC simulation mode"),
      ).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/agentic-sdlc/repos/demoorg/agentic-demo/simulate",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
