"use client";

/**
 * Unified state hook for the per-Epic page.
 *
 * Combines:
 *   1) An initial `GET /api/ship-loop/repos/{owner}/{repo}/epics/{epicId}`
 *      fetch that seeds the Epic, child sub-tasks, PRs, deploys,
 *      recent events, and the caller's needs_me list.
 *   2) The SSE stream at `.../events`, which patches that state in
 *      place as the worker projects new events.
 *
 * Reconciliation rules:
 *   - artifact_upserted: replace the matching child by artifact_id
 *     within its bucket; if no match, append. Mid-stream stage
 *     transitions are reflected via `current_stage` on the upserted
 *     artifact (which is exactly the truth-source per
 *     contracts/sse-channels.md -- "UI state is reconciled by
 *     current_stage on the artifact, not by the order of events").
 *   - event_appended: prepend to `recent_events`, capped at 100 to
 *     match the server's initial response.
 *   - stage_transition: ignored at this layer (artifact_upserted
 *     follows it and is the canonical signal).
 *   - webhook_health: surface the latest snapshot for the UI badge.
 *   - heartbeat / connected: no state mutation.
 *
 * Errors and reload:
 *   - The initial fetch sets `error` and leaves prior state intact
 *     so a transient failure does not blank the page.
 *   - When the stream issues a terminal error
 *     (feature_disabled, access_revoked) the hook stops applying
 *     events and exposes that code via `terminal`.
 *
 * The hook is read-only. HITL actions are issued via the dedicated
 * action APIs and propagate back through the stream.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useShipLoopStream,
  type ShipLoopStreamMessage,
  type ShipLoopStreamStatus,
} from "@/hooks/use-ship-loop-stream";
import type {
  ShipLoopArtifact,
  ShipLoopEvent,
  WebhookHealthStatus,
} from "@/types/ship-loop";

type SafeShipLoopEvent = Omit<ShipLoopEvent, "payload" | "_id">;

interface EpicDetailFetchResponse {
  epic: ShipLoopArtifact;
  subtasks: ShipLoopArtifact[];
  pull_requests: ShipLoopArtifact[];
  deploys: ShipLoopArtifact[];
  recent_events: SafeShipLoopEvent[];
  needs_me: string[];
}

export interface EpicShipState {
  epic: ShipLoopArtifact | null;
  subtasks: ShipLoopArtifact[];
  pull_requests: ShipLoopArtifact[];
  deploys: ShipLoopArtifact[];
  recent_events: SafeShipLoopEvent[];
  needs_me: string[];
  webhook_health: {
    status: WebhookHealthStatus;
    last_event_at: string | null;
  } | null;
}

export interface UseEpicShipStateReturn {
  state: EpicShipState;
  loading: boolean;
  error: string | null;
  status: ShipLoopStreamStatus;
  /** Set when the stream emits a terminal `error` event. */
  terminal: string | null;
  /** Re-run the initial fetch (does not touch the SSE connection). */
  refetch: () => void;
  /** Reset terminal flag and force a fresh stream connection. */
  reconnect: () => void;
}

interface UseEpicShipStateOptions {
  owner: string;
  repo: string;
  epicId: string;
  enabled: boolean;
}

const RECENT_EVENT_CAP = 100;

const EMPTY_STATE: EpicShipState = {
  epic: null,
  subtasks: [],
  pull_requests: [],
  deploys: [],
  recent_events: [],
  needs_me: [],
  webhook_health: null,
};

function detailUrl(owner: string, repo: string, epicId: string): string {
  return `/api/ship-loop/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/epics/${encodeURIComponent(epicId)}`;
}

function eventsUrl(owner: string, repo: string, epicId: string): string {
  return `${detailUrl(owner, repo, epicId)}/events`;
}

function replaceOrAppend(
  list: ShipLoopArtifact[],
  next: ShipLoopArtifact,
): ShipLoopArtifact[] {
  const idx = list.findIndex((a) => a.artifact_id === next.artifact_id);
  if (idx === -1) return [next, ...list];
  const copy = list.slice();
  copy[idx] = next;
  return copy;
}

function bucketFor(
  state: EpicShipState,
  kind: ShipLoopArtifact["kind"],
): ShipLoopArtifact[] | null {
  if (kind === "subtask") return state.subtasks;
  if (kind === "pull_request") return state.pull_requests;
  if (kind === "deploy") return state.deploys;
  return null;
}

export function useEpicShipState({
  owner,
  repo,
  epicId,
  enabled,
}: UseEpicShipStateOptions): UseEpicShipStateReturn {
  const [state, setState] = useState<EpicShipState>(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchKey = useMemo(
    () => (enabled ? `${owner}/${repo}/${epicId}` : null),
    [enabled, owner, repo, epicId],
  );

  const runFetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch(detailUrl(owner, repo, epicId), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        // 401 / 404 / 5xx all surface as a string code; the page
        // chrome decides how to render. Critically, we do NOT clear
        // existing state -- a transient 5xx must not blank the
        // page mid-session.
        setError(`http_${res.status}`);
        return;
      }
      const body = (await res.json()) as EpicDetailFetchResponse;
      setState({
        epic: body.epic,
        subtasks: body.subtasks,
        pull_requests: body.pull_requests,
        deploys: body.deploys,
        recent_events: body.recent_events.slice(0, RECENT_EVENT_CAP),
        needs_me: body.needs_me,
        webhook_health: stateRef.current.webhook_health,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [enabled, owner, repo, epicId]);

  useEffect(() => {
    if (!fetchKey) {
      setState(EMPTY_STATE);
      return;
    }
    runFetch();
  }, [fetchKey, runFetch]);

  const handleEvent = useCallback(
    (msg: ShipLoopStreamMessage) => {
      switch (msg.event) {
        case "connected":
          // server_time could be surfaced for skew display; not yet.
          break;
        case "artifact_upserted": {
          const a = msg.data as ShipLoopArtifact;
          if (!a || typeof a !== "object" || !a.artifact_id) return;
          setState((prev) => {
            // The Epic itself can be upserted (e.g. a label change
            // moves it stage-wise). Detect by artifact_id == epicId.
            if (a.kind === "epic" && a.artifact_id === epicId) {
              return { ...prev, epic: a };
            }
            const bucket = bucketFor(prev, a.kind);
            if (!bucket) return prev;
            if (a.kind === "subtask") {
              return { ...prev, subtasks: replaceOrAppend(prev.subtasks, a) };
            }
            if (a.kind === "pull_request") {
              return {
                ...prev,
                pull_requests: replaceOrAppend(prev.pull_requests, a),
              };
            }
            if (a.kind === "deploy") {
              return { ...prev, deploys: replaceOrAppend(prev.deploys, a) };
            }
            return prev;
          });
          break;
        }
        case "event_appended": {
          const ev = msg.data as SafeShipLoopEvent;
          if (!ev || typeof ev !== "object") return;
          setState((prev) => ({
            ...prev,
            recent_events: [ev, ...prev.recent_events].slice(0, RECENT_EVENT_CAP),
          }));
          break;
        }
        case "stage_transition":
          // No-op: artifact_upserted is the canonical truth (per
          // contracts/sse-channels.md). We may surface this in a
          // toast layer later.
          break;
        case "webhook_health": {
          const data = msg.data as {
            status: WebhookHealthStatus;
            last_event_at: string | null;
          } | null;
          if (!data || typeof data !== "object") return;
          setState((prev) => ({ ...prev, webhook_health: data }));
          break;
        }
        case "heartbeat":
          break;
        case "error": {
          const code = (msg.data as { code?: string } | null)?.code;
          if (code === "feature_disabled" || code === "access_revoked") {
            setTerminal(code);
          }
          break;
        }
        default:
          break;
      }
    },
    [epicId],
  );

  const stream = useShipLoopStream({
    url: enabled && !terminal ? eventsUrl(owner, repo, epicId) : null,
    onEvent: handleEvent,
  });

  const reconnect = useCallback(() => {
    setTerminal(null);
    stream.reconnect();
  }, [stream]);

  return useMemo(
    () => ({
      state,
      loading,
      error,
      status: stream.status,
      terminal,
      refetch: () => void runFetch(),
      reconnect,
    }),
    [state, loading, error, stream.status, terminal, runFetch, reconnect],
  );
}
