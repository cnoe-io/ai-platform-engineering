"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Draft review: a per-page diff of a run's drafted changes against the live
 * wiki, with Approve/Reject for the whole run. The reviewer's actual
 * decision surface — the ingest log tells you what the agent did, this tells
 * you what it's asking you to accept.
 */

interface DraftPage {
  path: string;
  oldBody: string;
  newBody: string;
  isNewPage: boolean;
}

export function DraftReviewView({
  slug,
  runId,
  onResolved,
}: {
  slug: string;
  runId: string;
  onResolved: () => void;
}) {
  const [pages, setPages] = useState<DraftPage[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [resolving, setResolving] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tome/projects/${slug}/ingests/${runId}/review`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const loaded = (j?.data?.pages ?? []) as DraftPage[];
        setPages(loaded);
        setSelectedPath(loaded[0]?.path ?? null);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, runId]);

  const resolve = async (action: "approve" | "reject") => {
    setResolving(action);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/ingests/${runId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `${action} failed (${res.status})`);
      }
      onResolved();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setResolving(null);
    }
  };

  const selected = pages?.find((p) => p.path === selectedPath) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <p className="text-sm font-medium">Draft review</p>
          <p className="text-xs text-muted-foreground">
            {pages === null
              ? "Loading changed pages…"
              : `${pages.length} page${pages.length === 1 ? "" : "s"} changed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void resolve("approve")}
            disabled={resolving !== null}
          >
            {resolving === "approve" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void resolve("reject")}
            disabled={resolving !== null}
          >
            {resolving === "reject" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Reject
          </Button>
        </div>
      </div>
      {error && (
        <p className="border-b bg-destructive/10 px-5 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 border-r">
          <ScrollArea className="h-full">
            {pages === null ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : pages.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No pages changed.</p>
            ) : (
              <ul>
                {pages.map((p) => (
                  <li key={p.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(p.path)}
                      className={cn(
                        "block w-full truncate border-b px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted",
                        selectedPath === p.path && "bg-muted",
                      )}
                      title={p.path}
                    >
                      {p.path}
                      {p.isNewPage && (
                        <span className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                          new
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </aside>

        <section className="min-w-0 flex-1 overflow-auto bg-muted/30">
          {!selected ? (
            <p className="p-6 text-sm text-muted-foreground">Pick a page on the left.</p>
          ) : (
            <ReactDiffViewer
              oldValue={selected.oldBody}
              newValue={selected.newBody}
              splitView
              compareMethod={DiffMethod.WORDS}
              useDarkTheme={dark}
              leftTitle={selected.isNewPage ? "(new page)" : "live"}
              rightTitle="draft"
            />
          )}
        </section>
      </div>
    </div>
  );
}
