"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Square } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Live (and historical) ingest log — a Docker-style tail of one run. Polls the
 * run while it's active; color-codes the marker prefixes the runner emits.
 * Port of TTT `IngestLogStream` / the history `LogViewport`.
 */

type RunStatus = "queued" | "running" | "succeeded" | "failed";

interface RunDetail {
  id: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  log: string;
}

export function IngestRunView({
  slug,
  runId,
  onPagesChanged,
}: {
  slug: string;
  runId: string;
  onPagesChanged?: () => void;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [stopping, setStopping] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevLines = useRef(0);

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
        const active = detail.status === "running" || detail.status === "queued";
        if (active) {
          timer = setTimeout(poll, 900);
        } else {
          // One last refresh of the wiki — the agent may have written pages.
          onPagesChanged?.();
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
  }, [slug, runId, onPagesChanged]);

  const lines = useMemo(
    () => (run?.log || "").split("\n").filter((l) => l.length > 0),
    [run?.log],
  );

  // Auto-scroll to bottom while the run is active.
  useEffect(() => {
    if (!run) return;
    const active = run.status === "running" || run.status === "queued";
    if (active && lines.length !== prevLines.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLines.current = lines.length;
  }, [lines.length, run]);

  const status = run?.status ?? "queued";

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-100 shadow">
        <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${dotClass(status)}`} />
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
              ingest · {status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(status === "running" || status === "queued") && (
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
              {status === "running" || status === "queued" ? "live" : "log"}
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
    </div>
  );
}

function dotClass(status: RunStatus): string {
  if (status === "running" || status === "queued")
    return "bg-emerald-400 animate-pulse";
  return status === "succeeded" ? "bg-emerald-500" : "bg-red-500";
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
