/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RepoCatchUpTimeline } from "@/components/agentic-sdlc/RepoCatchUpTimeline";

describe("RepoCatchUpTimeline", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("plays curated replay events and highlights the current artifact", async () => {
    const highlightSpy = jest.fn();
    const snapshotSpy = jest.fn();
    const stopSpy = jest.fn();
    window.addEventListener("agentic-sdlc:replay-highlight", highlightSpy);
    window.addEventListener("agentic-sdlc:board-snapshot", snapshotSpy);
    window.addEventListener("agentic-sdlc:board-replay-stop", stopSpy);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        snapshots: [
          {
            id: "delivery-1",
            event_title: "pull request opened: Add replay",
            actor_label: "coder-bot",
            occurred_at: "2026-05-11T09:45:00.000Z",
            artifact_id: "PR_123",
            swim_lanes: [
              {
                stage: "review_hitl",
                items: [
                  {
                    artifact_id: "PR_123",
                    kind: "pull_request",
                    title: "Add replay",
                    state: "open",
                    resolved: false,
                    current_stage: "review_hitl",
                    actor_kind: "human",
                    agent_label: null,
                    agent_name: null,
                    status_label: null,
                    escalation_labels: [],
                    github_url: "https://github.com/demoorg/agentic-demo/pull/1",
                    last_event_at: "2026-05-11T09:45:00.000Z",
                  },
                ],
              },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<RepoCatchUpTimeline owner="demoorg" repo="agentic-demo" />);

    fireEvent.click(screen.getByRole("button", { name: /open catch-up replay/i }));
    expect(await screen.findByText("pull request opened: Add replay")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /replay interval/i })).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: /play catch-up/i }));

    await waitFor(() =>
      expect(snapshotSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            owner: "demoorg",
            repo: "agentic-demo",
            snapshot: expect.objectContaining({
              id: "delivery-1",
              swim_lanes: expect.any(Array),
            }),
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(highlightSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            owner: "demoorg",
            repo: "agentic-demo",
            changedArtifactIds: ["PR_123"],
          }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    await waitFor(() =>
      expect(stopSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { owner: "demoorg", repo: "agentic-demo" },
        }),
      ),
    );
    window.removeEventListener("agentic-sdlc:replay-highlight", highlightSpy);
    window.removeEventListener("agentic-sdlc:board-snapshot", snapshotSpy);
    window.removeEventListener("agentic-sdlc:board-replay-stop", stopSpy);
  });

  it("starts as a floating replay button to preserve repo detail screen space", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ snapshots: [] }),
    }) as unknown as typeof fetch;

    render(<RepoCatchUpTimeline owner="demoorg" repo="agentic-demo" />);

    expect(screen.getByRole("button", { name: /open catch-up replay/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play catch-up/i })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
