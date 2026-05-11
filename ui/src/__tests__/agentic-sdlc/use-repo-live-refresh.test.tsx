/**
 * @jest-environment jsdom
 *
 * The repo detail page already knows how to refetch its widgets when
 * `agentic-sdlc:repo-synced` fires. This hook bridges the live repo SSE
 * stream into that existing refresh event.
 */

import { act, renderHook } from "@testing-library/react";

const captured: {
  url?: string | null;
  onEvent?: (msg: { event: string; data: unknown }) => void;
} = {};

jest.mock("@/hooks/use-agentic-sdlc-stream", () => ({
  __esModule: true,
  useAgenticSdlcStream: ({
    url,
    onEvent,
  }: {
    url: string | null;
    onEvent: (msg: { event: string; data: unknown }) => void;
  }) => {
    captured.url = url;
    captured.onEvent = onEvent;
    return {
      status: "open",
      retryCount: 0,
      reconnect: jest.fn(),
      close: jest.fn(),
    };
  },
}));

import { useRepoAgenticSdlcLiveRefresh } from "@/hooks/use-repo-agentic-sdlc-live-refresh";

beforeEach(() => {
  jest.useFakeTimers();
  captured.url = undefined;
  captured.onEvent = undefined;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("useRepoAgenticSdlcLiveRefresh", () => {
  it("subscribes to the repo-level stream", () => {
    renderHook(() =>
      useRepoAgenticSdlcLiveRefresh({
        owner: "demoorg",
        repo: "agentic-demo",
        enabled: true,
      }),
    );

    expect(captured.url).toBe("/api/agentic-sdlc/repos/demoorg/agentic-demo/events");
  });

  it("batches bursty repo stream events into one changed-artifact refresh", () => {
    const listener = jest.fn();
    window.addEventListener("agentic-sdlc:repo-synced", listener);
    renderHook(() =>
      useRepoAgenticSdlcLiveRefresh({
        owner: "demoorg",
        repo: "agentic-demo",
        enabled: true,
      }),
    );

    act(() => {
      captured.onEvent?.({
        event: "artifact_upserted",
        data: { artifact_id: "I_1" },
      });
      captured.onEvent?.({
        event: "event_appended",
        data: { event_id: "E_1", artifact_id: "I_2" },
      });
      captured.onEvent?.({
        event: "webhook_health",
        data: { status: "healthy" },
      });
    });

    expect(listener).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      detail: {
        owner: "demoorg",
        repo: "agentic-demo",
        eventCount: 3,
        changedArtifactIds: ["I_1", "I_2"],
      },
    });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("agentic-sdlc:repo-synced", listener);
  });

  it("does not dispatch refreshes for heartbeat-only frames", () => {
    const listener = jest.fn();
    window.addEventListener("agentic-sdlc:repo-synced", listener);
    renderHook(() =>
      useRepoAgenticSdlcLiveRefresh({
        owner: "demoorg",
        repo: "agentic-demo",
        enabled: true,
      }),
    );

    act(() => {
      captured.onEvent?.({ event: "heartbeat", data: { t: "now" } });
    });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("agentic-sdlc:repo-synced", listener);
  });
});
