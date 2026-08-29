import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

let mockLiveIssueHandler:
  | ((message: { event: string; data: unknown }) => void)
  | null = null;

jest.mock("@/hooks/use-agentic-sdlc-stream", () => ({
  useAgenticSdlcStream: ({
    onEvent,
  }: {
    onEvent: (message: { event: string; data: unknown }) => void;
  }) => {
    mockLiveIssueHandler = onEvent;
    return { status: "open", retryCount: 0, reconnect: jest.fn(), close: jest.fn() };
  },
}));

import { issueFiltersForLabel } from "@/lib/tome/issue-filter-views";
import { GithubIssuesPanel } from "../GithubIssuesPanel";

describe("GithubIssuesPanel", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    mockLiveIssueHandler = null;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("supports GitHub-style filters without exposing saved-view creation", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [
            {
              repo: "example/service",
              number: 42,
              title: "Open upstream issue",
              body: "The authoritative issue body.",
              url: "https://github.com/example/service/issues/42",
              state: "open",
              stateReason: null,
              displayStatus: "open",
              priority: "high",
              labels: ["bug", "priority:high"],
              assignees: ["test-user"],
              author: "issue-author",
              milestone: "v1",
              updatedAt: "2026-08-27T00:00:00Z",
            },
            {
              repo: "example/service",
              number: 41,
              title: "Closed upstream issue",
              body: null,
              url: "https://github.com/example/service/issues/41",
              state: "closed",
              stateReason: "completed",
              displayStatus: "resolved",
              priority: null,
              labels: ["feature"],
              assignees: [],
              author: "other-author",
              milestone: null,
              updatedAt: "2026-08-26T00:00:00Z",
            },
          ],
          credentialConfigured: true,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    });

    render(
      <GithubIssuesPanel
        slug="example-project"
        canEdit={false}
      />,
    );

    expect(await screen.findByText("Open upstream issue")).toBeInTheDocument();
    expect(screen.getByText("Closed upstream issue")).toBeInTheDocument();
    expect(screen.queryByText(/2 of 2 items/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About GitHub issues" }));
    expect(screen.getByText(/2 of 2 items/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About GitHub issues" }));
    expect(screen.getByLabelText("Filter GitHub issues")).toBeInTheDocument();

    expect(screen.queryByLabelText("Filter by GitHub state")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByLabelText("Filter by GitHub state"), {
      target: { value: "closed" },
    });
    expect(screen.queryByText("Open upstream issue")).not.toBeInTheDocument();
    expect(screen.getByText("Closed upstream issue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About GitHub issues" }));
    expect(screen.getByText(/1 of 2 items/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About GitHub issues" }));

    expect(screen.queryByRole("button", { name: "Save as view" })).not.toBeInTheDocument();
  });

  it("adds and removes tracked labels through the delegated write route", async () => {
    const issue = {
      repo: "example/service",
      number: 42,
      title: "Tracked work",
      body: null,
      url: "https://github.com/example/service/issues/42",
      state: "open" as const,
      stateReason: null,
      displayStatus: "open" as const,
      priority: null,
      labels: [] as string[],
      assignees: [],
      author: "test-user",
      milestone: null,
      updatedAt: "2026-08-27T00:00:00Z",
    };
    const initialPayload = {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [issue],
          credentialConfigured: true,
          writeCredentialConfigured: true,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    };
    const mutationPayload = (labels: string[]) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { issue: { ...issue, labels } },
      }),
    });
    mockFetch
      .mockResolvedValueOnce(initialPayload)
      .mockResolvedValueOnce(mutationPayload(["critical"]))
      .mockResolvedValueOnce(mutationPayload([]));

    render(<GithubIssuesPanel slug="example-project" canEdit />);
    expect(await screen.findByText("Tracked work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add label to Tracked work" }));
    fireEvent.click(screen.getByRole("button", { name: "critical" }));
    const removeLabels = await screen.findByRole("button", {
      name: "Remove label from Tracked work",
    });
    await waitFor(() => expect(removeLabels).not.toBeDisabled());

    fireEvent.click(removeLabels);
    fireEvent.click(screen.getByRole("button", { name: "critical" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", {
        name: "Remove label from Tracked work",
      })).not.toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/github-issues"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          repo: "example/service",
          number: 42,
          label: "critical",
          operation: "add",
        }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/github-issues"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          repo: "example/service",
          number: 42,
          label: "critical",
          operation: "remove",
        }),
      }),
    );
  });

  it("explains how to configure a missing project GitHub credential", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [],
          credentialConfigured: false,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    });

    render(<GithubIssuesPanel slug="example-project" canEdit />);

    expect(
      await screen.findByText(/GitHub is not connected/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connected Credentials" })).toHaveAttribute(
      "href",
      "/credentials",
    );
  });

  it("reloads webhook-backed issue state when the window regains focus", async () => {
    const response = (title: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [{
            repo: "example/service",
            number: 42,
            title,
            body: null,
            url: "https://github.com/example/service/issues/42",
            state: "open",
            stateReason: null,
            displayStatus: "open",
            priority: null,
            labels: [],
            assignees: [],
            author: "test-user",
            milestone: null,
            updatedAt: "2026-08-28T00:00:00Z",
          }],
          credentialConfigured: true,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    });
    mockFetch
      .mockResolvedValueOnce(response("Before webhook"))
      .mockResolvedValue(response("After webhook"));

    render(<GithubIssuesPanel slug="example-project" canEdit={false} />);
    expect(await screen.findByText("Before webhook")).toBeInTheDocument();

    fireEvent.focus(window);

    expect(await screen.findByText("After webhook")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("reloads immediately when the GitHub issue event stream updates", async () => {
    const response = (title: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [{
            repo: "example/service",
            number: 42,
            title,
            body: null,
            url: "https://github.com/example/service/issues/42",
            state: "open",
            stateReason: null,
            displayStatus: "open",
            priority: null,
            labels: ["decision"],
            assignees: [],
            author: "test-user",
            milestone: null,
            updatedAt: "2026-08-28T00:00:00Z",
          }],
          credentialConfigured: true,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    });
    mockFetch
      .mockResolvedValueOnce(response("Before webhook"))
      .mockResolvedValue(response("After webhook"));

    render(
      <GithubIssuesPanel
        slug="example-project"
        canEdit={false}
        initialFilters={issueFiltersForLabel("decision")}
      />,
    );
    expect(await screen.findByText("Before webhook")).toBeInTheDocument();

    jest.useFakeTimers();
    act(() => {
      mockLiveIssueHandler?.({ event: "github_issue_updated", data: {} });
      mockLiveIssueHandler?.({ event: "github_issue_updated", data: {} });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });

    expect(await screen.findByText("After webhook")).toBeInTheDocument();
    // A webhook burst is coalesced into one cache reload.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("filters issues and discussions by shared GitHub labels", async () => {
    const item = {
      repo: "example/service",
      body: null,
      state: "open",
      stateReason: null,
      displayStatus: "open",
      priority: null,
      assignees: [],
      author: "test-user",
      milestone: null,
      updatedAt: "2026-08-27T00:00:00Z",
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [
            {
              ...item,
              contentType: "issue",
              number: 42,
              title: "Critical issue",
              url: "https://github.com/example/service/issues/42",
              labels: ["critical"],
            },
            {
              ...item,
              contentType: "discussion",
              number: 52,
              title: "Critical discussion",
              url: "https://github.com/example/service/discussions/52",
              labels: ["critical", "decision"],
              category: "Ideas",
            },
            {
              ...item,
              contentType: "discussion",
              number: 53,
              title: "General discussion",
              url: "https://github.com/example/service/discussions/53",
              labels: ["question"],
              category: "Q&A",
            },
          ],
          credentialConfigured: true,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    });

    render(<GithubIssuesPanel slug="example-project" canEdit />);
    expect(await screen.findByText("Critical discussion")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    fireEvent.change(screen.getByLabelText("Filter by GitHub content type"), {
      target: { value: "discussion" },
    });
    expect(screen.queryByText("Critical issue")).not.toBeInTheDocument();
    expect(screen.getByText("Critical discussion")).toBeInTheDocument();
    expect(screen.queryByLabelText("Move Critical discussion")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter by GitHub content type"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("Filter by GitHub label"), {
      target: { value: "critical" },
    });
    expect(screen.getByText("Critical issue")).toBeInTheDocument();
    expect(screen.getByText("Critical discussion")).toBeInTheDocument();
    expect(screen.queryByText("General discussion")).not.toBeInTheDocument();
  });

  it("loads a saved label filter even when GitHub returns different casing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [
            {
              repo: "example/service",
              number: 7,
              title: "Architecture decision",
              body: null,
              url: "https://github.com/example/service/issues/7",
              state: "open",
              stateReason: null,
              displayStatus: "open",
              priority: null,
              labels: ["Decision"],
              assignees: [],
              author: "test-user",
              milestone: null,
              updatedAt: "2026-08-27T00:00:00Z",
            },
            {
              repo: "example/service",
              number: 8,
              title: "Unrelated issue",
              body: null,
              url: "https://github.com/example/service/issues/8",
              state: "open",
              stateReason: null,
              displayStatus: "open",
              priority: null,
              labels: ["bug"],
              assignees: [],
              author: "test-user",
              milestone: null,
              updatedAt: "2026-08-27T00:00:00Z",
            },
          ],
          credentialConfigured: true,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    });

    render(
      <GithubIssuesPanel
        slug="example-project"
        canEdit={false}
        initialFilters={issueFiltersForLabel("decision")}
        title="Decisions"
      />,
    );

    expect(await screen.findByText("Architecture decision")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated issue")).not.toBeInTheDocument();
    expect(screen.getByText("Decisions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters 1" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters 1" }));
    expect(screen.getByLabelText("Filter by GitHub label")).toHaveValue("decision");
    fireEvent.click(screen.getByRole("button", { name: "About GitHub issues" }));
    expect(screen.getByText(/1 of 2 items/)).toBeInTheDocument();
  });

  it("drags any editable issue to another column and persists the move upstream", async () => {
    const issue = {
      repo: "example/service",
      number: 42,
      title: "Open upstream issue",
      body: "The authoritative issue body.",
      url: "https://github.com/example/service/issues/42",
      state: "open" as const,
      stateReason: null,
      displayStatus: "open" as const,
      priority: null,
      labels: ["bug"],
      assignees: [],
      author: "issue-author",
      milestone: null,
      updatedAt: "2026-08-27T00:00:00Z",
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            issues: [issue],
            credentialConfigured: true,
            repos: ["example/service"],
            rollupProjectSlugs: ["example-project"],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            issue: {
              ...issue,
              state: "closed",
              stateReason: "completed",
              displayStatus: "resolved",
            },
            warning:
              "The issue moved, but its GitHub Project status could not be updated. The data steward must reauthorize GitHub in Connected Credentials with Projects write access",
            warningCode: "TOME_STEWARD_GITHUB_PROJECT_WRITE_DENIED",
          },
        }),
      });

    render(<GithubIssuesPanel slug="example-project" canEdit />);

    const handle = await screen.findByLabelText("Move Open upstream issue");
    const resolvedColumn = screen.getByLabelText("Resolved issues");
    fireEvent.mouseDown(handle, { button: 0 });
    fireEvent.mouseEnter(resolvedColumn);
    fireEvent.mouseUp(resolvedColumn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "/api/tome/projects/example-project/github-issues",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            repo: "example/service",
            number: 42,
            status: "resolved",
          }),
        }),
      );
    });
    expect(resolvedColumn).toHaveTextContent("Open upstream issue");
    expect(
      await screen.findByText(/its GitHub Project status could not be updated/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Connected Credentials" }),
    ).toHaveAttribute("href", "/credentials");
  });

  it("supports keyboard status movement and hides write controls from viewers", async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issues: [
            {
              repo: "example/service",
              number: 9,
              title: "Keyboard issue",
              body: null,
              url: "https://github.com/example/service/issues/9",
              state: "open",
              stateReason: null,
              displayStatus: "open",
              priority: null,
              labels: [],
              assignees: [],
              author: null,
              milestone: null,
              updatedAt: null,
            },
          ],
          credentialConfigured: true,
          repos: ["example/service"],
          rollupProjectSlugs: ["example-project"],
        },
      }),
    };
    mockFetch.mockResolvedValue(response);

    const { unmount } = render(
      <GithubIssuesPanel slug="example-project" canEdit={false} />,
    );
    expect(await screen.findByText("Keyboard issue")).toBeInTheDocument();
    expect(screen.queryByLabelText("Move Keyboard issue")).not.toBeInTheDocument();
    unmount();

    mockFetch
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            issue: {
              ...(await response.json()).data.issues[0],
              displayStatus: "in_progress",
              labels: ["in-progress"],
            },
          },
        }),
      });
    render(<GithubIssuesPanel slug="example-project" canEdit />);
    const handle = await screen.findByLabelText("Move Keyboard issue");
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "/api/tome/projects/example-project/github-issues",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            repo: "example/service",
            number: 9,
            status: "in_progress",
          }),
        }),
      );
    });
  });
});
