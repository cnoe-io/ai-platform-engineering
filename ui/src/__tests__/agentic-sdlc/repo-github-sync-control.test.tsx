/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";

import { RepoGitHubSyncControl } from "@/components/agentic-sdlc/RepoGitHubSyncControl";

describe("RepoGitHubSyncControl", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    window.sessionStorage.setItem(
      "agentic-sdlc:auto-sync:demoorg/agentic-demo",
      String(Date.now()),
    );
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("shows animated refresh affordances while GitHub sync is running", () => {
    global.fetch = jest.fn(
      () =>
        new Promise<Response>(() => {
          // Keep the request pending so the component remains in syncing state.
        }),
    ) as unknown as typeof fetch;

    render(<RepoGitHubSyncControl owner="demoorg" repo="agentic-demo" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh from github/i }));

    const button = screen.getByRole("button", { name: /refresh from github/i });
    expect(button).toBeDisabled();
    expect(button.querySelector("[data-github-refresh-halo]")).toHaveClass(
      "motion-safe:animate-ping",
    );
    expect(button.querySelector("[data-github-refresh-icon]")).toHaveClass(
      "motion-safe:animate-spin",
    );
  });
});
