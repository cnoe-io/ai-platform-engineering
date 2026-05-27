/**
 * Unit tests for /auth/reauth-complete page
 *
 * This page is the OIDC callback destination for new-tab silent re-auth:
 *   1. On mount it broadcasts { type: "SESSION_REFRESHED" } on "caipe-auth"
 *   2. It calls window.close() to shut the tab
 *   3. If window.close() is blocked, it renders a "close this tab" fallback
 *
 * The consumer side (TokenExpiryGuard) is tested separately in
 * src/components/__tests__/token-expiry-guard.test.tsx, which covers
 * receiving SESSION_REFRESHED and silently calling updateSession().
 */

import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture BroadcastChannel instances so tests can inspect calls.
type MockChannel = {
  postMessage: jest.Mock;
  close: jest.Mock;
};
const channelInstances: MockChannel[] = [];

beforeEach(() => {
  channelInstances.length = 0;

  (global as any).BroadcastChannel = jest
    .fn()
    .mockImplementation((_name: string) => {
      const instance: MockChannel = {
        postMessage: jest.fn(),
        close: jest.fn(),
      };
      channelInstances.push(instance);
      return instance;
    });

  // Default: window.close() is a no-op (browser silently ignores it).
  Object.defineProperty(window, "close", {
    value: jest.fn(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import ReauthCompletePage from "../page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReauthCompletePage", () => {
  // ── Broadcast ──────────────────────────────────────────────────────────────

  describe("BroadcastChannel", () => {
    it("opens a BroadcastChannel named 'caipe-auth' on mount", async () => {
      await act(async () => {
        render(<ReauthCompletePage />);
      });
      expect(global.BroadcastChannel).toHaveBeenCalledWith("caipe-auth");
    });

    it("posts { type: 'SESSION_REFRESHED' } on mount", async () => {
      await act(async () => {
        render(<ReauthCompletePage />);
      });
      expect(channelInstances).toHaveLength(1);
      expect(channelInstances[0].postMessage).toHaveBeenCalledWith({
        type: "SESSION_REFRESHED",
      });
    });

    it("closes the BroadcastChannel after posting", async () => {
      await act(async () => {
        render(<ReauthCompletePage />);
      });
      expect(channelInstances[0].close).toHaveBeenCalled();
    });

    it("posts exactly once on mount (not on re-render)", async () => {
      let rerender!: (ui: React.ReactNode) => void;
      await act(async () => {
        ({ rerender } = render(<ReauthCompletePage />));
      });

      await act(async () => {
        rerender(<ReauthCompletePage />);
      });

      expect(channelInstances[0].postMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ── window.close ──────────────────────────────────────────────────────────

  describe("window.close", () => {
    it("calls window.close() on mount", async () => {
      await act(async () => {
        render(<ReauthCompletePage />);
      });
      expect(window.close).toHaveBeenCalled();
    });
  });

  // ── Fallback UI ────────────────────────────────────────────────────────────

  describe("fallback UI", () => {
    it("renders fallback text when window.close() is a no-op (tab not closed)", async () => {
      // window.close() is already mocked as a no-op — the tab stays open.
      await act(async () => {
        render(<ReauthCompletePage />);
      });

      // The fallback message should be visible.
      await waitFor(() => {
        expect(
          screen.getByText(/authentication complete/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/close this tab/i)).toBeInTheDocument();
      });
    });
  });

  // ── BroadcastChannel not supported ────────────────────────────────────────

  describe("BroadcastChannel unavailable", () => {
    it("does not throw when BroadcastChannel constructor throws", async () => {
      (global as any).BroadcastChannel = jest.fn().mockImplementation(() => {
        throw new Error("BroadcastChannel not supported");
      });

      await expect(
        act(async () => {
          render(<ReauthCompletePage />);
        }),
      ).resolves.not.toThrow();
    });

    it("still calls window.close() when BroadcastChannel throws", async () => {
      (global as any).BroadcastChannel = jest.fn().mockImplementation(() => {
        throw new Error("not supported");
      });

      await act(async () => {
        render(<ReauthCompletePage />);
      });

      expect(window.close).toHaveBeenCalled();
    });
  });

  // ── Ordering: broadcast before close ──────────────────────────────────────

  it("broadcasts SESSION_REFRESHED before calling window.close()", async () => {
    const callOrder: string[] = [];

    (global as any).BroadcastChannel = jest
      .fn()
      .mockImplementation((_name: string) => ({
        postMessage: jest.fn(() => callOrder.push("postMessage")),
        close: jest.fn(),
      }));

    Object.defineProperty(window, "close", {
      value: jest.fn(() => callOrder.push("window.close")),
      writable: true,
      configurable: true,
    });

    await act(async () => {
      render(<ReauthCompletePage />);
    });

    expect(callOrder.indexOf("postMessage")).toBeLessThan(
      callOrder.indexOf("window.close"),
    );
  });
});
