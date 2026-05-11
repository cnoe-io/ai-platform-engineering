/**
 * @jest-environment jsdom
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

import { useAgenticSdlcPortfolioLiveRefresh } from "@/hooks/use-agentic-sdlc-portfolio-live-refresh";

beforeEach(() => {
  captured.url = undefined;
  captured.onEvent = undefined;
});

describe("useAgenticSdlcPortfolioLiveRefresh", () => {
  it("subscribes to the portfolio-level stream", () => {
    renderHook(() => useAgenticSdlcPortfolioLiveRefresh({ enabled: true }));

    expect(captured.url).toBe("/api/agentic-sdlc/events");
  });

  it("dispatches the portfolio refresh event when artifacts change", () => {
    const listener = jest.fn();
    window.addEventListener("agentic-sdlc:portfolio-synced", listener);
    renderHook(() => useAgenticSdlcPortfolioLiveRefresh({ enabled: true }));

    act(() => {
      captured.onEvent?.({
        event: "artifact_upserted",
        data: { repo_id: "99000001", artifact_id: "I_1" },
      });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      detail: { repo_id: "99000001" },
    });
    window.removeEventListener("agentic-sdlc:portfolio-synced", listener);
  });

  it("does not dispatch refreshes for heartbeat-only frames", () => {
    const listener = jest.fn();
    window.addEventListener("agentic-sdlc:portfolio-synced", listener);
    renderHook(() => useAgenticSdlcPortfolioLiveRefresh({ enabled: true }));

    act(() => {
      captured.onEvent?.({ event: "heartbeat", data: { t: "now" } });
    });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("agentic-sdlc:portfolio-synced", listener);
  });
});
