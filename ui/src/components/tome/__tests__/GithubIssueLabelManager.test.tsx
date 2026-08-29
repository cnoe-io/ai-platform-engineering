import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GithubIssueLabelManager } from "../GithubIssueLabelManager";

describe("GithubIssueLabelManager", () => {
  const mockFetch = jest.fn();
  const issue = {
    repo: "example/service",
    number: 42,
    title: "Tracked work",
    url: "https://github.com/example/service/issues/42",
    state: "open" as const,
    labels: [] as string[],
    updatedAt: "2026-08-28T00:00:00Z",
  };

  const response = (data: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  });

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not load issues until the user searches", async () => {
    mockFetch.mockResolvedValue(response({
      issues: [issue],
      credentialConfigured: true,
      writeCredentialConfigured: true,
    }));

    render(<GithubIssueLabelManager slug="example-project" canEdit />);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText("Search for an issue to manage labels")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search GitHub issues" }), {
      target: { value: "42" },
    });

    expect(await screen.findByText("Tracked work")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/tome/projects/example-project/github-issues?content_type=issue&q=42&limit=20",
      ),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("adds and removes tracked labels through the delegated write route", async () => {
    mockFetch
      .mockResolvedValueOnce(response({
        issues: [issue],
        credentialConfigured: true,
        writeCredentialConfigured: true,
      }))
      .mockResolvedValueOnce(response({ issue: { ...issue, labels: ["critical"] } }))
      .mockResolvedValueOnce(response({ issue }));

    render(<GithubIssueLabelManager slug="example-project" canEdit />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search GitHub issues" }), {
      target: { value: "tracked" },
    });
    expect(await screen.findByText("Tracked work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add label to Tracked work" }));
    fireEvent.click(screen.getByRole("button", { name: "Critical" }));

    const removeLabels = await screen.findByRole("button", {
      name: "Remove label from Tracked work",
    });
    await waitFor(() => expect(removeLabels).not.toBeDisabled());
    fireEvent.click(removeLabels);
    fireEvent.click(screen.getByRole("button", { name: "Critical" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", {
        name: "Remove label from Tracked work",
      })).not.toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/tome/projects/example-project/github-issues",
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
      "/api/tome/projects/example-project/github-issues",
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

  it("directs editors to Connected Credentials when steward writes are unavailable", async () => {
    mockFetch.mockResolvedValue(response({
      issues: [issue],
      credentialConfigured: true,
      writeCredentialConfigured: false,
      writeCredentialOwner: "steward@example.test",
    }));

    render(<GithubIssueLabelManager slug="example-project" canEdit />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search GitHub issues" }), {
      target: { value: "tracked" },
    });

    expect(await screen.findByText(/steward@example.test/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connected Credentials" })).toHaveAttribute(
      "href",
      "/credentials",
    );
    expect(screen.queryByRole("button", { name: "Add label to Tracked work" }))
      .not.toBeInTheDocument();
  });
});
