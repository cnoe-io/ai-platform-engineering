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
    expect(refresh).toHaveAttribute(
      "title",
      expect.stringMatching(/pull current issues and prs/i),
    );
    expect(screen.queryByText(/github state refresh/i)).not.toBeInTheDocument();

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
      if (url.includes("/event-feed")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: "event-1",
                category: "pull_request",
                tone: "agent",
                title: "PR opened",
                description: "pull request PR_node_…",
                actor_label: "coder-bot",
                actor_kind: "agent",
                artifact_label: "pull request PR_node_…",
                occurred_at: "2026-05-05T20:00:00.000Z",
                details: {
                  source: "github",
                  github_event_type: "pull_request",
                  github_action: "opened",
                  artifact_kind: "pull_request",
                  artifact_id: "PR_node_1234567890",
                  epic_id: "I_epic",
                  projection_status: "projected",
                  delivered_at: "2026-05-05T20:00:00.000Z",
                },
              },
              {
                id: "event-2",
                category: "deploy",
                tone: "success",
                title: "Deployment succeeded",
                description: "deploy DEP_node_…",
                actor_label: "deployer-bot",
                actor_kind: "agent",
                artifact_label: "deploy DEP_node_…",
                occurred_at: "2026-05-05T21:00:00.000Z",
                details: {
                  source: "github",
                  github_event_type: "deployment_status",
                  github_action: "success",
                  artifact_kind: "deploy",
                  artifact_id: "DEP_node_1234567890",
                  epic_id: "I_epic",
                  projection_status: "projected",
                  delivered_at: "2026-05-05T21:00:00.000Z",
                },
              },
              {
                id: "event-3",
                category: "issue",
                tone: "default",
                title: "Issue synchronized",
                description: "task I_issue_…",
                actor_label: "system",
                actor_kind: "system",
                artifact_label: "task I_issue_…",
                occurred_at: "2026-05-05T19:00:00.000Z",
                duplicate_count: 4,
                details: {
                  source: "ui",
                  github_event_type: "issues",
                  github_action: "synchronize",
                  artifact_kind: "subtask",
                  artifact_id: "I_issue_1234567890",
                  epic_id: null,
                  projection_status: "projected",
                  delivered_at: "2026-05-05T19:00:00.000Z",
                },
              },
            ],
            pagination: {
              page: url.includes("page=2") ? 2 : 1,
              page_size: url.includes("limit=25") ? 25 : 10,
              page_size_options: [10, 25, 50, 100, 500],
              has_previous: url.includes("page=2"),
              has_next: !url.includes("page=2"),
              total_visible: 42,
            },
          }),
        } as Response);
      }
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
    expect(screen.queryByText(/github state refresh/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh from github/i })).toHaveAttribute(
      "title",
      expect.stringMatching(/pull current issues and prs/i),
    );
    expect(screen.getAllByText(/agents in action/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/live swim lanes/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /swim lanes/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: /architect work/i })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getAllByText("Create an SDLC Dashboard").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/wire skills middleware/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approve pr #482/i)).not.toBeInTheDocument();
    expect(screen.getByText(/repo operating snapshot/i)).toBeInTheDocument();
    expect(await screen.findByText(/repo event feed/i)).toBeInTheDocument();
    expect(screen.getByText("PR opened")).toBeInTheDocument();
    expect(screen.getByText("Deployment succeeded")).toBeInTheDocument();
    expect(screen.getByText("Issue synchronized")).toBeInTheDocument();
    expect(screen.getByText("4 repeats")).toBeInTheDocument();
    expect(screen.getByLabelText(/show events/i)).toHaveValue("10");
    expect(screen.getByText(/page 1/i)).toBeInTheDocument();
    expect(
      (global.fetch as jest.Mock).mock.calls.some((call) =>
        String(call[0]).includes("/event-feed?limit=10&page=1"),
      ),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(/show events/i), {
      target: { value: "25" },
    });
    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some((call) =>
          String(call[0]).includes("/event-feed?limit=25&page=1"),
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some((call) =>
          String(call[0]).includes("/event-feed?limit=25&page=2"),
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: /issues/i }));
    expect(screen.getByText("Issue synchronized")).toBeInTheDocument();
    expect(screen.queryByText("PR opened")).not.toBeInTheDocument();
    expect(screen.queryByText("Deployment succeeded")).not.toBeInTheDocument();
    expect(screen.queryByText(/event type/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /issue synchronized/i }));
    expect(screen.getByText(/event type/i)).toBeInTheDocument();
    expect(screen.getByText("issues")).toBeInTheDocument();
    expect(screen.getByText("projected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /deploys/i }));
    expect(screen.queryByText("PR opened")).not.toBeInTheDocument();
    expect(screen.queryByText("Issue synchronized")).not.toBeInTheDocument();
    expect(screen.getByText("Deployment succeeded")).toBeInTheDocument();
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

  it("lets operators collapse repo detail panels to focus the page", async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/epics") && !url.includes("/simulate")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            counts: {
              open_epics: 1,
              in_flight_subtasks: 1,
              prs_awaiting_review: 1,
              deploys_24h: 0,
            },
            activity_24h: 2,
            stage_counts: [{ stage: "implement", count: 1 }],
            human_queue: {
              needs_human_count: 1,
              oldest_waiting_since: "2026-05-07T08:01:00Z",
              items: [
                {
                  artifact_id: "PR_1",
                  kind: "pull_request",
                  title: "Needs review",
                  current_stage: "review_hitl",
                  github_url: "https://github.com/demoorg/agentic-demo/pull/1",
                  last_event_at: "2026-05-07T08:01:00Z",
                },
              ],
            },
            swim_lanes: [
              {
                stage: "implement",
                items: [
                  {
                    artifact_id: "I_1",
                    kind: "subtask",
                    title: "Implement collapsible panels",
                    current_stage: "implement",
                    actor_kind: "agent",
                    agent_name: "Coder",
                    agent_label: "agent:coder",
                    status_label: "status:in-progress",
                    escalation_labels: [],
                    github_url: "https://github.com/demoorg/agentic-demo/issues/1",
                    last_event_at: "2026-05-07T08:00:00Z",
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
              artifact_id: "I_2",
              title: "Plan repo dashboard",
              current_stage: "plan",
              needs_human: false,
              stalled_since: null,
              child_counts: { subtasks: 1, prs: 0, deploys: 0 },
              github_url: "https://github.com/demoorg/agentic-demo/issues/2",
              last_event_at: "2026-05-07T08:00:00Z",
            },
          ],
          next_cursor: null,
        }),
      } as Response);
    }) as unknown as typeof fetch;

    render(<RepoDetailShell owner="demoorg" repo="agentic-demo" />);

    await waitFor(() =>
      expect(screen.getAllByText("Implement collapsible panels").length).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(screen.getByText("Plan repo dashboard")).toBeInTheDocument(),
    );
    expect(screen.getByText("Needs review")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /collapse agents in action/i }),
    );
    expect(
      screen.queryByRole("region", { name: /coder work/i }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/agents in action/i).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: /collapse live swim lanes/i }),
    );
    expect(
      screen.queryByRole("img", { name: /swim lanes/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /collapse epics/i }));
    expect(screen.queryByText("Plan repo dashboard")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /collapse repo operating snapshot/i }),
    );
    expect(screen.queryByText(/events in the last 24h/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /collapse human queue/i }),
    );
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
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
        screen.getAllByText("Refactor react app to be template app").length,
      ).toBeGreaterThan(0),
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
