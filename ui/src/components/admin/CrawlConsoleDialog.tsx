"use client";

/**
 * Global Crawl Console dialog.
 *
 * Renders the live event log of every in-flight + recent hub
 * crawl. Designed for admins debugging a stuck or surprising
 * crawl: each row is a single fetch with timing, status, and an
 * "I want to know why" hint button on errors.
 *
 * Mounted once at the app shell level (commit 6 wires it into
 * the admin layout), driven entirely by the global
 * ``useCrawlConsoleStore``. The Preview / Refresh buttons in
 * SkillHubsSection don't pass any props -- they just call
 * ``startCrawlStream`` and the store does the rest.
 *
 * # Layout
 *
 *   +--------------------------------------------------------------+
 *   | Crawl Console (3 running)                              [x]   |
 *   +-----------------------+--------------------------------------+
 *   | RUN LIST              | Active run header + summary          |
 *   |  - Refresh acme/tools |                                      |
 *   |    running (12s)      | [filter chips: tree, skill_md,       |
 *   |  - Preview foo/bar    |  ancillary, warnings, errors]        |
 *   |    succeeded          |                                      |
 *   |  - Refresh baz        | [event log, scrollable]              |
 *   |    failed             |   12:34:01.234  GET ...tree?page=1   |
 *   |                       |     -> 200 (142ms, 4.7KB)            |
 *   |                       |   12:34:01.376  page 1: 87 entries   |
 *   |                       |   ...                                |
 *   +-----------------------+--------------------------------------+
 *   |              [Cancel] [Copy log] [Clear finished]            |
 *   +--------------------------------------------------------------+
 *
 * # Why no virtualization
 *
 * The encoder caps at 5000 events; rendering 5000 rows in a
 * `<div>` is fine on modern hardware. Adding react-virtual would
 * be premature optimization that complicates testing. If we
 * ever raise the cap to 100k, revisit.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type CrawlEvent,
  type CrawlRequestPhase,
} from "@/lib/crawl-events";
import {
  useCrawlConsoleStore,
  type CrawlRun,
  type CrawlRunStatus,
} from "@/store/crawl-console-store";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

type FilterChip = "tree" | "skill_md" | "ancillary" | "warnings" | "errors";

const FILTER_CHIPS: ReadonlyArray<{ id: FilterChip; label: string }> = [
  { id: "tree", label: "Tree pages" },
  { id: "skill_md", label: "SKILL.md" },
  { id: "ancillary", label: "Ancillary" },
  { id: "warnings", label: "Warnings" },
  { id: "errors", label: "Errors" },
];

function shouldShowEvent(event: CrawlEvent, active: ReadonlySet<FilterChip>): boolean {
  // Bookend events always show -- they're the run's identity.
  if (event.type === "started" || event.type === "done") return true;
  // Empty filter set = show everything (default state).
  if (active.size === 0) return true;
  if (event.type === "error" && active.has("errors")) return true;
  if (event.type === "warning" && active.has("warnings")) return true;
  if (event.type === "page" && active.has("tree")) return true;
  if (event.type === "skill_found" && active.has("skill_md")) return true;
  if (event.type === "request") {
    if (active.has(event.phase as FilterChip)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-run badge styling
// ---------------------------------------------------------------------------

function statusBadgeColor(status: CrawlRunStatus): string {
  switch (status) {
    case "running":
      return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-200";
    case "succeeded":
      return "bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-200";
    case "failed":
      return "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-200";
    case "aborted":
      return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-200";
    case "broken_stream":
      return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-200";
  }
}

function statusLabel(status: CrawlRunStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "broken_stream":
      return "stream lost";
  }
}

function elapsedLabel(run: CrawlRun): string {
  const end = run.ended_at ?? Date.now();
  const seconds = Math.max(0, Math.round((end - run.started_at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatTime(iso: string | undefined, fallback: number): string {
  const d = iso ? new Date(iso) : new Date(fallback);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Run list (left rail)
// ---------------------------------------------------------------------------

interface RunListProps {
  runs: readonly CrawlRun[];
  activeRunId: string | null;
  onSelect: (id: string) => void;
}

function RunList({ runs, activeRunId, onSelect }: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        No crawls yet. Click <strong>Preview</strong> or <strong>Refresh</strong>{" "}
        on a hub to start one.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border" role="listbox" aria-label="Crawl runs">
      {runs.map((run) => {
        const isActive = run.id === activeRunId;
        return (
          <li key={run.id}>
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              onClick={() => onSelect(run.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 hover:bg-accent transition-colors",
                isActive && "bg-accent",
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {run.kind}
                </span>
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded border",
                    statusBadgeColor(run.status),
                  )}
                >
                  {statusLabel(run.status)}
                </span>
              </div>
              <div className="text-sm font-medium truncate" title={run.label}>
                {run.label}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {elapsedLabel(run)}
                {run.events.length > 0 && (
                  <span className="ml-2">{run.events.length} events</span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

function statusColor(status: number): string {
  if (status === 0) return "text-rose-600 dark:text-rose-400";
  if (status >= 500) return "text-red-600 dark:text-red-400";
  if (status >= 400) return "text-amber-600 dark:text-amber-400";
  if (status >= 300) return "text-cyan-600 dark:text-cyan-400";
  return "text-green-700 dark:text-green-400";
}

function phaseLabel(phase: CrawlRequestPhase): string {
  switch (phase) {
    case "tree":
      return "tree";
    case "skill_md":
      return "skill";
    case "ancillary":
      return "ancillary";
    case "introspect":
      return "introspect";
  }
}

function bytesLabel(bytes?: number): string | null {
  if (typeof bytes !== "number" || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

interface EventRowProps {
  event: CrawlEvent;
  index: number;
}

function EventRow({ event, index }: EventRowProps) {
  switch (event.type) {
    case "started":
      return (
        <div className="font-mono text-xs py-1 text-muted-foreground border-l-2 border-blue-500 pl-2">
          <span className="tabular-nums">{formatTime(event.started_at, Date.now())}</span>{" "}
          ▶ started — {event.provider} · {event.project}
          {event.api_host && (
            <span className="ml-1 text-[11px] opacity-70">
              ({event.api_host})
            </span>
          )}
        </div>
      );
    case "request": {
      const bytes = bytesLabel(event.bytes);
      return (
        <div className="font-mono text-xs py-0.5 hover:bg-accent/50 px-2 -mx-2 rounded">
          <span className="text-muted-foreground tabular-nums">
            #{index + 1}
          </span>{" "}
          <span className="text-muted-foreground">{event.method}</span>{" "}
          <span className="text-[11px] uppercase opacity-60">
            [{phaseLabel(event.phase)}]
          </span>{" "}
          <span className="text-foreground/80 break-all">{event.url}</span>
          <div className="ml-6 text-muted-foreground">
            → <span className={statusColor(event.status)}>{event.status || "ERR"}</span>{" "}
            <span className="tabular-nums">{event.duration_ms}ms</span>
            {bytes && <span className="ml-1">· {bytes}</span>}
          </div>
          {event.body_preview && (
            <pre className="mt-1 ml-6 p-2 bg-muted rounded text-[11px] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {event.body_preview}
            </pre>
          )}
        </div>
      );
    }
    case "page":
      return (
        <div className="font-mono text-xs py-0.5 px-2 -mx-2 text-cyan-700 dark:text-cyan-400">
          page {event.page}: {event.entries} entries
          {event.has_next && <span className="ml-1 opacity-70">(more)</span>}
        </div>
      );
    case "skill_found":
      return (
        <div className="font-mono text-xs py-0.5 px-2 -mx-2 text-green-700 dark:text-green-400">
          ✓ {event.name}{" "}
          <span className="text-muted-foreground">({event.path})</span>
          {event.ancillary_count > 0 && (
            <span className="ml-1 text-[11px] opacity-70">
              +{event.ancillary_count} files
            </span>
          )}
        </div>
      );
    case "warning":
      return (
        <div className="font-mono text-xs py-1 px-2 -mx-2 text-amber-700 dark:text-amber-400 border-l-2 border-amber-500 pl-2">
          <strong>warning [{event.code}]:</strong> {event.message}
          {event.context && Object.keys(event.context).length > 0 && (
            <pre className="mt-1 text-[11px] opacity-80">
              {JSON.stringify(event.context, null, 2)}
            </pre>
          )}
        </div>
      );
    case "error":
      return (
        <div className="font-mono text-xs py-1 px-2 -mx-2 text-red-700 dark:text-red-400 border-l-2 border-red-500 pl-2">
          <strong>error [{event.code}]:</strong> {event.message}
          {event.hint && (
            <div className="mt-1 text-[11px] text-foreground/80 whitespace-pre-wrap">
              💡 {event.hint}
            </div>
          )}
        </div>
      );
    case "done":
      return (
        <div className="font-mono text-xs py-1 px-2 -mx-2 text-blue-700 dark:text-blue-400 border-l-2 border-blue-500 pl-2">
          ▶ done — {event.skills} skills, {event.requests} requests in{" "}
          <span className="tabular-nums">{event.duration_ms}ms</span>
          {event.truncation.kind !== "ok" && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              ⚠ {event.truncation.kind} truncation
            </span>
          )}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Active run pane (right side)
// ---------------------------------------------------------------------------

interface ActiveRunPaneProps {
  run: CrawlRun | undefined;
}

function ActiveRunPane({ run }: ActiveRunPaneProps) {
  const cancelRun = useCrawlConsoleStore((s) => s.cancelRun);
  const removeRun = useCrawlConsoleStore((s) => s.removeRun);
  const [filters, setFilters] = React.useState<Set<FilterChip>>(new Set());
  const logEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom when new events arrive AND the user
  // hasn't scrolled up. We don't track manual scroll state to keep
  // this simple; if it becomes annoying we can add a "stick to
  // bottom" toggle. For now, follow the latest event count.
  React.useEffect(() => {
    if (run && run.status === "running") {
      // jsdom doesn't implement scrollIntoView, so guard the call
      // for tests. In real browsers scrollIntoView is always
      // available on a non-null Element ref.
      const node = logEndRef.current;
      if (node && typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "auto", block: "end" });
      }
    }
  }, [run, run?.events.length, run?.status]);

  if (!run) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select a run from the list to view its log.
      </div>
    );
  }

  const visibleEvents = run.events.filter((e) => shouldShowEvent(e, filters));

  const handleCopy = async () => {
    const text = run.events
      .map((e) => JSON.stringify(e))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Some browsers + insecure contexts reject clipboard writes.
      // Fall back: select-all the log via a textarea hack would
      // complicate the component for a marginal use case. Accept
      // the failure -- the operator can still re-run the crawl.
    }
  };

  const toggleFilter = (chip: FilterChip) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header / summary */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate" title={run.label}>
              {run.label}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {run.kind} · {statusLabel(run.status)} · {elapsedLabel(run)}
              {run.events.length > 0 && (
                <span className="ml-1">· {run.events.length} events</span>
              )}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {run.status === "running" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancelRun(run.id)}
              >
                Cancel
              </Button>
            )}
            {run.status !== "running" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeRun(run.id)}
              >
                Remove
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleCopy}>
              Copy log
            </Button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {FILTER_CHIPS.map((chip) => {
            const active = filters.has(chip.id);
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => toggleFilter(chip.id)}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {chip.label}
              </button>
            );
          })}
          {filters.size > 0 && (
            <button
              type="button"
              onClick={() => setFilters(new Set())}
              className="text-[11px] px-2 py-0.5 text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Log */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-0.5"
        data-testid="crawl-console-log"
      >
        {visibleEvents.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">
            {run.events.length === 0
              ? "Waiting for first event…"
              : "No events match the current filters."}
          </div>
        ) : (
          visibleEvents.map((event, idx) => (
            <EventRow key={idx} event={event} index={idx} />
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function CrawlConsoleDialog() {
  const {
    runs,
    isOpen,
    activeRunId,
    setActiveRun,
    open,
    close,
    clearFinished,
  } = useCrawlConsoleStore();
  // Avoid using `selectActiveRun` inside the component because
  // zustand's default equality treats the result as a new object
  // on every render; we already have access to `runs` and id, so
  // derive locally.
  const activeRun = React.useMemo(
    () => runs.find((r) => r.id === activeRunId),
    [runs, activeRunId],
  );
  const runningCount = runs.filter((r) => r.status === "running").length;
  const finishedCount = runs.length - runningCount;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? open() : close())}>
      <DialogContent
        className={cn(
          // Override Radix's default max-w-lg with a console-sized
          // surface. 1024px keeps the URL column readable on
          // standard laptop widths without wasting space on
          // ultrawides where the URL column would just stretch.
          "sm:max-w-[1024px] w-[95vw] h-[80vh] p-0 flex flex-col gap-0",
        )}
        data-testid="crawl-console-dialog"
      >
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base flex items-center gap-2">
            Crawl Console
            {runningCount > 0 && (
              <span className="text-xs font-normal text-blue-600 dark:text-blue-400">
                {runningCount} running
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Live progress for hub crawls. Closing the dialog does not stop
            in-flight crawls.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex min-h-0">
          <aside className="w-72 border-r overflow-y-auto shrink-0">
            <RunList
              runs={runs}
              activeRunId={activeRunId}
              onSelect={setActiveRun}
            />
          </aside>
          <main className="flex-1 min-w-0">
            <ActiveRunPane run={activeRun} />
          </main>
        </div>

        <footer className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
          <span className="text-xs text-muted-foreground">
            {runningCount} running · {finishedCount} finished
          </span>
          <div className="flex gap-2">
            {finishedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={clearFinished}>
                Clear finished
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={close}>
              Close
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
