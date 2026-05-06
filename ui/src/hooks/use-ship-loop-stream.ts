"use client";

/**
 * Generic SSE subscriber for Ship Loop streams.
 *
 * Wraps EventSource with the contract-mandated reconnect policy
 * (1s, 2s, 4s, ..., capped at 30s -- contracts/sse-channels.md). Any
 * `event:` name we know about (connected, artifact_upserted,
 * event_appended, stage_transition, webhook_health, heartbeat,
 * error, plus the inbox_* variants) is dispatched to the caller's
 * `onEvent` handler with the parsed JSON `data` payload.
 *
 * The hook does NOT decide how to merge events into application
 * state -- that is `useEpicShipState`'s job. We keep the transport
 * concern separate so the same primitive can drive the per-Epic
 * stream and the future needs-you inbox firehose.
 *
 * Lifecycle:
 *   - URL change      -> close existing source, open a new one.
 *   - URL becomes null -> close, no reconnect.
 *   - On `error` event MID-STREAM -> caller's onEvent fires with
 *     the {code, message} body THEN the source closes and the
 *     reconnect timer kicks in. We do not auto-reconnect on
 *     `code: "feature_disabled"` or `code: "access_revoked"` --
 *     those are terminal.
 *
 * `status` is exported so the UI can render a "reconnecting"
 * indicator without re-deriving the state from console messages.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ShipLoopStreamEvent =
  | "connected"
  | "artifact_upserted"
  | "event_appended"
  | "stage_transition"
  | "webhook_health"
  | "inbox_added"
  | "inbox_removed"
  | "inbox_initial"
  | "heartbeat"
  | "error";

export interface ShipLoopStreamMessage<T = unknown> {
  event: ShipLoopStreamEvent;
  data: T;
}

export type ShipLoopStreamStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

interface UseShipLoopStreamOptions {
  /**
   * Full path to the SSE endpoint, e.g.
   * `/api/ship-loop/repos/owner/repo/epics/I_42/events`. Pass null
   * to hold the connection closed (during loading, gating, etc.).
   */
  url: string | null;
  /**
   * Called for every parsed event. Stable reference recommended;
   * the hook does not memoise.
   */
  onEvent: (msg: ShipLoopStreamMessage) => void;
  /**
   * When true, do not attempt to reconnect after stream errors --
   * useful in tests and when the caller wants to wire its own
   * recovery strategy.
   */
  disableReconnect?: boolean;
}

interface UseShipLoopStreamReturn {
  status: ShipLoopStreamStatus;
  /** Number of reconnection attempts since the last successful open. */
  retryCount: number;
  /** Force a reconnect now (resets the backoff timer). */
  reconnect: () => void;
  /** Permanently close the stream without reconnect. */
  close: () => void;
}

const TERMINAL_ERROR_CODES = new Set(["feature_disabled", "access_revoked"]);

const KNOWN_EVENTS: ShipLoopStreamEvent[] = [
  "connected",
  "artifact_upserted",
  "event_appended",
  "stage_transition",
  "webhook_health",
  "inbox_added",
  "inbox_removed",
  "inbox_initial",
  "heartbeat",
  "error",
];

function nextBackoffMs(retry: number): number {
  // 1s, 2s, 4s, 8s, 16s, 30s (cap). Matches sse-channels.md.
  const ms = Math.min(30_000, 1000 * Math.pow(2, retry));
  return ms;
}

export function useShipLoopStream({
  url,
  onEvent,
  disableReconnect,
}: UseShipLoopStreamOptions): UseShipLoopStreamReturn {
  const [status, setStatus] = useState<ShipLoopStreamStatus>("idle");
  const [retryCount, setRetryCount] = useState(0);

  const sourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const connect = useCallback(
    (currentUrl: string, attempt: number) => {
      if (terminalRef.current) return;
      if (typeof window === "undefined" || typeof EventSource === "undefined") {
        // Server-side render or SSR-only env: leave status idle and exit.
        return;
      }

      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      setRetryCount(attempt);

      const es = new EventSource(currentUrl);
      sourceRef.current = es;

      es.addEventListener("open", () => {
        setStatus("open");
        setRetryCount(0);
      });

      const handle = (name: ShipLoopStreamEvent) => (raw: MessageEvent) => {
        let data: unknown = null;
        try {
          data = raw.data ? JSON.parse(raw.data as string) : null;
        } catch {
          // The contract guarantees JSON; ignore malformed frames
          // rather than crashing the whole stream.
          return;
        }
        onEventRef.current({ event: name, data });
        if (name === "error") {
          const code = (data as { code?: string } | null)?.code;
          if (code && TERMINAL_ERROR_CODES.has(code)) {
            terminalRef.current = true;
            cleanup();
            setStatus("closed");
          }
        }
      };
      for (const name of KNOWN_EVENTS) {
        es.addEventListener(name, handle(name) as EventListener);
      }

      es.onerror = () => {
        if (terminalRef.current) return;
        cleanup();
        if (disableReconnect) {
          setStatus("closed");
          return;
        }
        const next = attempt + 1;
        const delay = nextBackoffMs(next);
        setStatus("reconnecting");
        setRetryCount(next);
        retryTimerRef.current = setTimeout(() => connect(currentUrl, next), delay);
      };
    },
    [cleanup, disableReconnect],
  );

  const reconnect = useCallback(() => {
    cleanup();
    terminalRef.current = false;
    if (url) connect(url, 0);
  }, [cleanup, connect, url]);

  const close = useCallback(() => {
    terminalRef.current = true;
    cleanup();
    setStatus("closed");
  }, [cleanup]);

  useEffect(() => {
    cleanup();
    terminalRef.current = false;
    if (!url) {
      setStatus("idle");
      setRetryCount(0);
      return cleanup;
    }
    connect(url, 0);
    return cleanup;
  }, [url, cleanup, connect]);

  return useMemo(
    () => ({ status, retryCount, reconnect, close }),
    [status, retryCount, reconnect, close],
  );
}
