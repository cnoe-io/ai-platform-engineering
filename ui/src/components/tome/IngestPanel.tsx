"use client";

import { useCallback, useEffect, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Loader2, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProjectAssets } from "@/components/tome/ProjectAssets";
import { cn } from "@/lib/utils";

interface RunSummary {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  greenfield: boolean;
  started_at: string;
  finished_at: string | null;
  log_lines: number;
  error: string | null;
}

/**
 * Ingest landing — kick a run (optional one-shot seed instruction) and browse
 * recent runs. Selecting a run opens its log. Port of TTT's `ReingestButton`
 * dialog + the run list from `IngestHistoryPanel`.
 */
export function IngestPanel({
  slug,
  canEdit,
  onOpenRun,
  onRunStarted,
}: {
  slug: string;
  canEdit: boolean;
  onOpenRun: (runId: string) => void;
  onRunStarted: (runId: string) => void;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [seed, setSeed] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tome/projects/${slug}/ingests`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      setRuns(json?.data?.runs ?? []);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
    // Refresh the list while something is running so statuses settle.
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  const inProgress = (runs ?? []).some(
    (r) => r.status === "running" || r.status === "queued",
  );

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/reingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: seed.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `reingest failed (${res.status})`);
      }
      const json = await res.json();
      setSeed("");
      await load();
      onRunStarted(json.data.runId);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStarting(false);
    }
  }, [slug, seed, load, onRunStarted]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 className="text-lg font-semibold">Run ingest agent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Re-run the agent over this project&apos;s sources to refresh the
            dynamic wiki pages. Stable pages are preserved.
          </p>
        </div>

        {/* Sources the agent reads (and that scope its MCP). */}
        <ProjectAssets slug={slug} canEdit={canEdit} />

        {/* Reingest control */}
        <div className="rounded-lg border p-4">
          <label className="mb-1 block text-sm font-medium">
            Seed instruction <span className="text-muted-foreground">(optional)</span>
          </label>
          <p className="mb-2 text-xs text-muted-foreground">
            A one-shot nudge for this run, e.g. &ldquo;focus on the auth
            refactor&rdquo;. Doesn&apos;t override page-kind preservation.
          </p>
          <TextareaAutosize
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            minRows={2}
            maxRows={6}
            placeholder="(blank = standard ingest)"
            disabled={!canEdit || starting}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={() => void start()}
              disabled={!canEdit || starting || inProgress}
              title={
                !canEdit
                  ? "You need edit access to run an ingest"
                  : inProgress
                    ? "An ingest is already running"
                    : "Run ingest"
              }
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {starting ? "Starting…" : inProgress ? "Ingest running…" : "Run ingest"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void load()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        {/* Run history */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            Recent runs
          </h3>
          {runs === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ingests yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenRun(r.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <StatusPill status={r.status} />
                    {r.greenfield && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                        greenfield
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {new Date(r.started_at).toLocaleString()}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {durationLabel(r)} · {r.log_lines} lines
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

function durationLabel(r: RunSummary): string {
  if (!r.finished_at) return "running";
  const s = Math.round(
    (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000,
  );
  return `${s}s`;
}

function StatusPill({ status }: { status: RunSummary["status"] }) {
  const cls =
    status === "succeeded"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        cls,
      )}
    >
      {status}
    </span>
  );
}
