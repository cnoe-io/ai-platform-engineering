import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/hooks/use-agentic-sdlc-stream", () => ({
  useAgenticSdlcStream: jest.fn(),
}));

import { GithubIssuesPanel } from "../GithubIssuesPanel";

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
  labels: ["tome:critical"],
  assignees: [],
  author: "test-user",
  milestone: null,
  updatedAt: "2026-08-27T00:00:00Z",
};

function issuesResponse(issues = [issue]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        issues,
        credentialConfigured: true,
        writeCredentialConfigured: true,
        repos: ["example/service"],
        rollupProjectSlugs: ["example-project"],
      },
    }),
  };
}

describe("GithubIssuesPanel", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("searches only the tracked issues returned by the server", async () => {
    mockFetch.mockResolvedValue(issuesResponse([
      issue,
      { ...issue, number: 43, title: "Another tracked item" },
    ]));

    render(<GithubIssuesPanel slug="example-project" canEdit={false} />);

    expect(await screen.findByText("Tracked work")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search tracked issues"), {
      target: { value: "another" },
    });
    expect(screen.queryByText("Tracked work")).not.toBeInTheDocument();
    expect(screen.getByText("Another tracked item")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("requests the selected TOME label from the server", async () => {
    mockFetch.mockResolvedValue(issuesResponse());

    render(
      <GithubIssuesPanel
        slug="example-project"
        canEdit={false}
        initialLabel="tome:critical"
        title="Critical"
      />,
    );

    expect(await screen.findByText("Tracked work")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tome/projects/example-project/github-issues?label=tome%3Acritical",
      undefined,
    );
    expect(screen.getByRole("heading", { name: "Critical issues" })).toBeInTheDocument();
  });

  it("adds and removes only TOME-owned tracked labels", async () => {
    const unlabelledIssue = { ...issue, labels: [] };
    const mutationResponse = (labels: string[]) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { issue: { ...unlabelledIssue, labels } },
      }),
    });
    mockFetch
      .mockResolvedValueOnce(issuesResponse([unlabelledIssue]))
      .mockResolvedValueOnce(mutationResponse(["tome:critical"]))
      .mockResolvedValueOnce(mutationResponse([]));

    render(<GithubIssuesPanel slug="example-project" canEdit />);
    expect(await screen.findByText("Tracked work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage tracking labels for Tracked work" }));
    fireEvent.click(screen.getByRole("button", { name: "Add tome:critical" }));
    await waitFor(() => {
      expect(screen.getByRole("button", {
        name: "Manage tracking labels for Tracked work",
      })).not.toBeDisabled();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Remove tome:critical" }));

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/tome/projects/example-project/github-issues",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          repo: "example/service",
          number: 42,
          label: "tome:critical",
          operation: "add",
        }),
      }),
    );
    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        "/api/tome/projects/example-project/github-issues",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            repo: "example/service",
            number: 42,
            label: "tome:critical",
            operation: "remove",
          }),
        }),
      );
    });
  });

  it("tracks an issue from an attached repository and mutates the panel data", async () => {
    const addedIssue = {
      ...issue,
      number: 99,
      title: "Newly tracked work",
      url: "https://github.com/example/service/issues/99",
    };
    mockFetch
      .mockResolvedValueOnce(issuesResponse([]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { issue: addedIssue },
        }),
      });

    render(<GithubIssuesPanel slug="example-project" canEdit />);
    await screen.findByLabelText("Search tracked issues");
    fireEvent.click(screen.getByRole("button", { name: "Add issue" }));
    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "example/service" },
    });
    fireEvent.change(screen.getByLabelText("Issue number"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to TOME" }));

    expect(await screen.findByText("Newly tracked work")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/tome/projects/example-project/github-issues",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          repo: "example/service",
          number: 99,
          label: "tome:critical",
          operation: "add",
        }),
      }),
    );
  });

  it("uses CSS line clamping instead of truncating issue descriptions", async () => {
    const body = "A detailed issue description that should remain intact for line clamping.".repeat(8);
    mockFetch.mockResolvedValue(issuesResponse([{ ...issue, body }]));

    render(<GithubIssuesPanel slug="example-project" canEdit={false} />);

    const description = await screen.findByText(body);
    expect(description).toHaveClass("line-clamp-3");
  });
});
