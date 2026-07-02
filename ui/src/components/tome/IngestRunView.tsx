"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Square } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/tome/ingest-format";

/**
 * Live (and historical) ingest log — a Docker-style tail of one run. Polls the
 * run while it's active; color-codes the marker prefixes the runner emits.
 *
 * For a BHAG synthesize cascade, the parent run shows a "Project ingests" panel
 * of its child re-ingests; clicking a child swaps the log pane to that child's
 * run (a separate self-polling pane), with a back link to the synthesis.
 */

type RunStatus = "queued" | "running" | "succeeded" | "failed";

interface RunDetail {
  id: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  log: string;
  cascade_id?: string | null;
  cascade_role?: "child" | "parent" | null;
  usage?: { output: number; input: number } | null;
}

interface CascadeChild {
  id: string;
  name: string;
  slug: string;
  status: RunStatus;
  error: string | null;
}

type ChildRef = { id: string; name: string; slug: string };

export function IngestRunView({
  slug,
  runId,
  onPagesChanged,
}: {
  slug: string;
  runId: string;
  onPagesChanged?: () => void;
}) {
  // The parent run's detail (cascade metadata + status), surfaced from the
  // parent pane. Retained while viewing a child so the cascade panel persists.
  // Reset on run change is handled by a `key` on this component in TomeWiki, so
  // these start fresh per run without a setState-in-effect.
  const [parent, setParent] = useState<RunDetail | null>(null);
  const [selectedChild, setSelectedChild] = useState<ChildRef | null>(null);

  const showCascade = Boolean(parent?.cascade_id && parent.cascade_role === "parent");
  const parentLabel = parent?.cascade_role === "parent" ? "synthesis" : "ingest";

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {showCascade && parent?.cascade_id && (
        <CascadePanel
          slug={slug}
          cascadeId={parent.cascade_id}
          selectedId={selectedChild?.id ?? null}
          onSelect={setSelectedChild}
        />
      )}

      {/* One log pane, keyed so switching parent<->child remounts it (fresh
          poll lifecycle, no stale state). The parent pane surfaces its status
          up; child panes are read-only views with a back link. */}
      {selectedChild ? (
        <RunLogPane
          key={`child-${selectedChild.id}`}
          slug={selectedChild.slug}
          runId={selectedChild.id}
          label={`project · ${selectedChild.name}`}
          headerLeft={
            <button
              type="button"
              onClick={() => setSelectedChild(null)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <ChevronLeft className="h-3 w-3" /> Synthesis
            </button>
          }
        />
      ) : (
        <RunLogPane
          key={`parent-${runId}`}
          slug={slug}
          runId={runId}
          label={parentLabel}
          allowStop
          onStatus={setParent}
          onFinished={onPagesChanged}
        />
      )}
    </div>
  );
}

/**
 * Self-contained log viewer for a single run: owns its poll, auto-scroll, and
 * (optionally) the stop control. Mount it (keyed by run) to start polling;
 * unmount to stop. `onStatus` surfaces each poll's detail to the parent.
 */
function RunLogPane({
  slug,
  runId,
  label,
  allowStop = false,
  headerLeft,
  onStatus,
  onFinished,
}: {
  slug: string;
  runId: string;
  label: string;
  allowStop?: boolean;
  headerLeft?: React.ReactNode;
  onStatus?: (detail: RunDetail) => void;
  onFinished?: () => void;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [stopping, setStopping] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevLines = useRef(0);
  const firedFinished = useRef(false);
  // Keep the latest callbacks without resubscribing the poll effect.
  const onStatusRef = useRef(onStatus);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onStatusRef.current = onStatus;
    onFinishedRef.current = onFinished;
  }, [onStatus, onFinished]);

  const stop = async () => {
    setStopping(true);
    try {
      await fetch(`/api/tome/projects/${slug}/ingests/${runId}`, { method: "DELETE" });
    } finally {
      setStopping(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/tome/projects/${slug}/ingests/${runId}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        const detail = json?.data as RunDetail;
        if (cancelled) return;
        setRun(detail);
        onStatusRef.current?.(detail);
        const active = detail.status === "running" || detail.status === "queued";
        if (active) {
          timer = setTimeout(poll, 900);
        } else if (!firedFinished.current) {
          firedFinished.current = true;
          onFinishedRef.current?.();
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug, runId]);

  const lines = useMemo(
    () => (run?.log || "").split("\n").filter((l) => l.length > 0),
    [run?.log],
  );

  const status = run?.status ?? "queued";
  const active = status === "running" || status === "queued";
  const tokens = run?.usage ? formatTokens(run.usage) : "";

  // Auto-scroll to bottom while the run is active.
  useEffect(() => {
    if (active && lines.length !== prevLines.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLines.current = lines.length;
  }, [lines.length, active]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-100 shadow">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {headerLeft}
          <span className={`inline-block h-2 w-2 rounded-full ${dotClass(status)}`} />
          <span className="truncate text-xs font-medium uppercase tracking-wider text-neutral-400">
            {label} · {status}
          </span>
          {tokens && (
            <span className="truncate text-xs font-medium tabular-nums text-neutral-500">
              · {tokens}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allowStop && active && (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={stopping}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-400 hover:bg-neutral-800 disabled:opacity-50"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            {active ? "live" : "log"}
          </span>
        </div>
      </div>
      <ScrollArea viewportRef={scrollRef} className="flex-1">
        <div
          className="px-3 py-2 font-mono text-[12px] leading-relaxed"
          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          {lines.length === 0 ? (
            <div className="text-neutral-600">[--:--:--] · agent starting up…</div>
          ) : (
            lines.map((raw, i) => <FormattedLine key={i} raw={raw} />)
          )}
          {run?.error && (
            <div className="mt-2 whitespace-pre-wrap break-words text-red-300">
              [error] {run.error}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function dotClass(status: RunStatus): string {
  if (status === "running") return "bg-emerald-400 animate-pulse";
  if (status === "queued") return "bg-neutral-500";
  return status === "succeeded" ? "bg-emerald-500" : "bg-red-500";
}

/**
 * Child re-ingest progress for a BHAG cascade. Polls the cascade endpoint while
 * any child is still active. Each row opens that child's log in the pane below.
 */
function CascadePanel({
  slug,
  cascadeId,
  selectedId,
  onSelect,
}: {
  slug: string;
  cascadeId: string;
  selectedId: string | null;
  onSelect: (child: ChildRef) => void;
}) {
  const [children, setChildren] = useState<CascadeChild[]>([]);
  const [counts, setCounts] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    queued: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/tome/projects/${slug}/cascades/${cascadeId}`);
        if (res.ok) {
          const json = await res.json();
          if (cancelled) return;
          const data = json?.data as { children: CascadeChild[]; counts: typeof counts };
          setChildren(data.children ?? []);
          setCounts(data.counts ?? null);
          const stillActive = (data.children ?? []).some(
            (c) => c.status === "queued" || c.status === "running",
          );
          if (stillActive) timer = setTimeout(poll, 2000);
          return;
        }
      } catch {
        /* transient — retry below */
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug, cascadeId]);

  if (children.length === 0) return null;

  const done = counts ? counts.succeeded + counts.failed : 0;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Project ingests
        </span>
        {counts && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {done}/{counts.total} done
            {counts.failed > 0 ? ` · ${counts.failed} failed` : ""}
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {children.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect({ id: c.id, name: c.name, slug: c.slug })}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-muted",
                selectedId === c.id && "bg-muted",
              )}
            >
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass(c.status)}`} />
              <span className="truncate" title={c.error || c.name}>
                {c.name}
              </span>
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                {c.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MARKER_COLORS: Record<string, string> = {
  "▶": "text-emerald-400 font-semibold",
  "✓": "text-emerald-400",
  "✗": "text-red-400",
  "→": "text-sky-400",
  "←": "text-neutral-300",
  "~": "text-amber-300",
  "✎": "text-violet-400",
  "·": "text-neutral-500",
};

function FormattedLine({ raw }: { raw: string }) {
  const m = raw.match(/^(\[[^\]]+\])\s+(.)\s?(.*)$/);
  if (!m) {
    return <div className="whitespace-pre-wrap break-words">{raw}</div>;
  }
  const [, ts, marker, rest] = m;
  const color = MARKER_COLORS[marker] ?? "text-neutral-400";
  return (
    <div className="whitespace-pre-wrap break-words">
      <span className="text-neutral-600">{ts} </span>
      <span className={color}>
        {marker} {rest}
      </span>
    </div>
  );
}
