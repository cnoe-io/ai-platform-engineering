/**
 * Global crawl-console store. Holds every in-flight + recent
 * crawl run for the admin "Live crawl" dialog.
 *
 * # Why global (not per-row)
 *
 * Two reasons:
 *
 *   1. Concurrency. An admin can kick off a Preview crawl on one
 *      hub, click Refresh on a different hub, and have both
 *      streams running simultaneously. A per-row dialog can only
 *      show one stream at a time and would confuse "I clicked
 *      something three minutes ago, where's the result?". The
 *      global modal has a left-rail run list so all in-flight
 *      runs are visible at once.
 *
 *   2. Survival across navigation. The admin may switch tabs
 *      (Hubs -> Skills -> Audit) while a refresh is running. A
 *      modal anchored to the SkillHubsSection unmounts on tab
 *      switch and the stream gets aborted. The global store
 *      lives at the app shell level, so the stream keeps
 *      running and the dialog can be re-opened from any tab.
 *
 * # Why zustand
 *
 * Aligns with existing project convention (see
 * unsaved-changes-store, feature-flag-store, task-config-store).
 * No context wiring; selectors are cheap; no React-tree
 * dependency for the AbortController plumbing the
 * crawl-stream-client owns.
 *
 * # Persistence
 *
 * Deliberately NONE. The dialog is a live observability tool;
 * persisting in-flight state across page reloads would be
 * misleading (the underlying stream is already gone). Refreshes
 * separately persist the encoded log on the hub doc -- that's
 * the "ask Mongo for the last run" path, distinct from this
 * store.
 */

import { create } from "zustand";
import type { CrawlEvent } from "@/lib/crawl-events";

// ---------------------------------------------------------------------------
// Run model
// ---------------------------------------------------------------------------

export type CrawlRunStatus =
  | "running" // stream open
  | "succeeded" // stream closed, terminal `done` event seen
  | "failed" // stream closed, terminal `error` event seen
  | "aborted" // user cancelled or AbortController fired
  | "broken_stream"; // stream closed without a terminal event (network drop)

export interface CrawlRun {
  /**
   * Stable run identifier. NOT the hub id -- two runs against
   * the same hub (e.g. user clicks Refresh twice) must remain
   * distinct so the dialog can show both progress timelines.
   */
  id: string;
  /** Display label for the run (e.g. ``Preview - acme/tools``). */
  label: string;
  /** Provider, mirrored from the started event. */
  provider?: "github" | "gitlab";
  /** Initiating action -- drives the badge color in the run list. */
  kind: "preview" | "refresh";
  /** Project (mirrored from the started event); undefined until first event. */
  project?: string;
  /** Wall-clock start (ms epoch). Set when the run is created locally. */
  started_at: number;
  /** Wall-clock end (ms epoch). Undefined while running. */
  ended_at?: number;
  status: CrawlRunStatus;
  /** Full event log (chronological). New events append. */
  events: CrawlEvent[];
  /**
   * AbortController for the in-flight fetch. Stored on the run
   * so the dialog can offer a Cancel button without coupling to
   * the fetch caller. Cleared once the run terminates (success,
   * failure, broken stream, or user abort) so we don't keep
   * dead controllers around forever.
   */
  abort?: AbortController;
}

interface CrawlConsoleState {
  /** All runs, newest-first (so the run list renders without sorting). */
  runs: CrawlRun[];
  /** Whether the global dialog is currently open. */
  isOpen: boolean;
  /** Active run shown in the dialog's main pane. */
  activeRunId: string | null;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Create a new run record and mark it as the active one. Auto-
   * opens the dialog when the first run starts so the operator
   * actually sees the live console (we don't make them notice a
   * status pill that wasn't there a moment ago). Subsequent
   * concurrent runs DON'T re-open if it was manually dismissed,
   * because that would feel intrusive.
   */
  startRun: (init: {
    id: string;
    label: string;
    kind: "preview" | "refresh";
    abort?: AbortController;
  }) => void;

  /** Append an event to a run; updates derived fields if a `started` event arrives. */
  appendEvent: (runId: string, event: CrawlEvent) => void;

  /**
   * Mark a run as terminated. ``status`` distinguishes succeeded
   * (saw `done`), failed (saw `error`), aborted (user clicked
   * Cancel), and broken_stream (network closed without a
   * terminal event -- treat as failure but distinguish so the
   * UI can suggest "re-run" instead of "fix the underlying
   * problem").
   */
  finishRun: (runId: string, status: Exclude<CrawlRunStatus, "running">) => void;

  /** Cancel an in-flight run (calls the AbortController + finishRun). */
  cancelRun: (runId: string) => void;

  /** Show the dialog. */
  open: () => void;

  /** Hide the dialog (does NOT cancel in-flight runs). */
  close: () => void;

  /** Switch which run is shown in the main pane. */
  setActiveRun: (runId: string) => void;

  /** Drop a run from the list (only allowed when not running). */
  removeRun: (runId: string) => void;

  /** Drop all non-running runs (used by the dialog's "Clear history" action). */
  clearFinished: () => void;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * Maximum number of runs we keep in memory. Running runs are
 * never pruned; we only drop the OLDEST FINISHED run when this
 * cap trips. Sized so a long-running admin session doesn't keep
 * hundreds of stale runs around.
 */
const MAX_RUNS = 20;

/**
 * Maximum number of events we buffer per run on the client side.
 * The server-side encoder caps at 5000; we use the same number
 * here so the client doesn't have to track wire-truncation
 * separately. If we ever want to render more, this is the knob.
 */
const MAX_EVENTS_PER_RUN = 5000;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCrawlConsoleStore = create<CrawlConsoleState>()((set, get) => ({
  runs: [],
  isOpen: false,
  activeRunId: null,

  startRun: ({ id, label, kind, abort }) => {
    const now = Date.now();
    const run: CrawlRun = {
      id,
      label,
      kind,
      started_at: now,
      status: "running",
      events: [],
      abort,
    };
    set((state) => {
      // Splice in newest-first; auto-prune the oldest finished
      // run when we exceed the cap. NEVER prune a running run --
      // that would orphan its abort controller.
      const next = [run, ...state.runs];
      if (next.length > MAX_RUNS) {
        const finishedFromOldest = [...next]
          .reverse()
          .findIndex((r) => r.status !== "running");
        if (finishedFromOldest >= 0) {
          const idx = next.length - 1 - finishedFromOldest;
          next.splice(idx, 1);
        }
      }
      // Auto-open ONLY on the first concurrent run. If the user
      // explicitly closed the dialog while another run was in
      // flight, leave it closed -- we'll show the status pill in
      // the admin header instead.
      const wasEmpty = state.runs.every((r) => r.status !== "running");
      const shouldOpen = wasEmpty ? true : state.isOpen;
      return {
        runs: next,
        activeRunId: id,
        isOpen: shouldOpen,
      };
    });
  },

  appendEvent: (runId, event) =>
    set((state) => ({
      runs: state.runs.map((r) => {
        if (r.id !== runId) return r;
        if (r.events.length >= MAX_EVENTS_PER_RUN) {
          // Hard cap on the client -- mirrors server cap so the
          // two layers truncate identically. The encoder
          // already emits a terminal `warning` when its cap
          // trips; we don't need to synthesize another one.
          return r;
        }
        // Promote project / provider from the `started` event
        // into the run's top-level fields so the run list can
        // render before any other event arrives.
        if (event.type === "started") {
          return {
            ...r,
            project: event.project,
            provider: event.provider,
            events: [...r.events, event],
          };
        }
        return { ...r, events: [...r.events, event] };
      }),
    })),

  finishRun: (runId, status) =>
    set((state) => ({
      runs: state.runs.map((r) =>
        r.id === runId
          ? {
              ...r,
              status,
              ended_at: Date.now(),
              // Drop the abort controller -- the stream is over;
              // keeping it would just confuse the run-list
              // "Cancel" button render logic.
              abort: undefined,
            }
          : r,
      ),
    })),

  cancelRun: (runId) => {
    const run = get().runs.find((r) => r.id === runId);
    if (!run || run.status !== "running") return;
    try {
      run.abort?.abort();
    } catch {
      // AbortController.abort throws on Node 18 if signal already
      // aborted; harmless. The terminal state below is what we
      // care about.
    }
    get().finishRun(runId, "aborted");
  },

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveRun: (runId) => set({ activeRunId: runId }),

  removeRun: (runId) =>
    set((state) => {
      const target = state.runs.find((r) => r.id === runId);
      if (!target || target.status === "running") return state;
      const filtered = state.runs.filter((r) => r.id !== runId);
      return {
        runs: filtered,
        activeRunId:
          state.activeRunId === runId
            ? (filtered[0]?.id ?? null)
            : state.activeRunId,
      };
    }),

  clearFinished: () =>
    set((state) => {
      const remaining = state.runs.filter((r) => r.status === "running");
      return {
        runs: remaining,
        activeRunId:
          remaining.find((r) => r.id === state.activeRunId)?.id ??
          remaining[0]?.id ??
          null,
      };
    }),
}));

// ---------------------------------------------------------------------------
// Selectors -- exported so tests can use them without re-implementing.
// ---------------------------------------------------------------------------

export const selectRunningCount = (s: CrawlConsoleState) =>
  s.runs.filter((r) => r.status === "running").length;

export const selectActiveRun = (s: CrawlConsoleState): CrawlRun | undefined =>
  s.runs.find((r) => r.id === s.activeRunId);
