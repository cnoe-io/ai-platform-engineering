"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ArtifactEvaluation } from "@/types/tome-evaluation";

/**
 * Per-page diff of what one ingest run changed. For a run awaiting review,
 * this is the reviewer's decision surface (Approve/Reject vs. what's live).
 * For a terminal run, it's read-only — the same diff, browsed after the
 * fact, since the log tells you what the agent DID but not what it wrote.
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
  canEdit,
  onResolved,
}: {
  slug: string;
  runId: string;
  canEdit: boolean;
  onResolved?: () => void;
}) {
  const [pages, setPages] = useState<DraftPage[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [resolving, setResolving] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Approve/Reject only make sense while the run is actually awaiting review —
  // fetched here so callers can just point this at any run id (a pending
  // draft or one long since terminal) without knowing its status upfront.
  const [reviewable, setReviewable] = useState(false);
  const [qualityEvaluation, setQualityEvaluation] = useState<ArtifactEvaluation | null>(null);
  const [qualityPolicy, setQualityPolicy] = useState<{
    mode: "off" | "observe" | "enforce";
    version: number | null;
    allow_steward_override: boolean;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tome/projects/${slug}/ingests/${runId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) {
          setReviewable(j?.data?.status === "awaiting_review");
          setQualityEvaluation(j?.data?.quality_evaluation ?? null);
          setQualityPolicy(j?.data?.quality_policy ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setReviewable(false);
      });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" && overrideReason.trim()
          ? { override_reason: overrideReason.trim() }
          : {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `${action} failed (${res.status})`);
      }
      onResolved?.();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setResolving(null);
    }
  };

  const selected = pages?.find((p) => p.path === selectedPath) ?? null;
  const failedBlockingRubrics = qualityEvaluation?.rubrics.filter(
    (rubric) => rubric.enabled && rubric.blocking && rubric.passed !== true,
  ) ?? [];
  const gateBlocked = qualityPolicy?.mode === "enforce" && (
    !qualityEvaluation
    || qualityEvaluation.status === "error"
    || failedBlockingRubrics.length > 0
    || qualityEvaluation.blocking_findings.length > 0
  );
  const overrideReady = qualityPolicy?.allow_steward_override && overrideReason.trim().length >= 10;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <p className="text-sm font-medium">{reviewable ? "Draft review" : "Changed pages"}</p>
          <p className="text-xs text-muted-foreground">
            {pages === null
              ? "Loading changed pages…"
              : `${pages.length} page${pages.length === 1 ? "" : "s"} changed`}
          </p>
        </div>
        {reviewable && canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void resolve("reject")}
              disabled={resolving !== null}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
            >
              {resolving === "reject" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              Reject
            </button>
            <button
              type="button"
              onClick={() => void resolve("approve")}
              disabled={resolving !== null || (gateBlocked && !overrideReady)}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {resolving === "approve" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Approve
            </button>
          </div>
        )}
        {reviewable && !canEdit && (
          <p className="text-xs text-muted-foreground">
            Only the data steward or a Tome admin can approve or reject this draft.
          </p>
        )}
      </div>
      {error && (
        <p className="border-b bg-destructive/10 px-5 py-2 text-sm text-destructive">{error}</p>
      )}

      {qualityPolicy && qualityPolicy.mode !== "off" && (
        <div className="space-y-2 border-b px-5 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Grounded quality</span>
            <span className={qualityEvaluation?.status === "passed" ? "text-emerald-600" : "text-destructive"}>
              {qualityEvaluation?.status ?? "not evaluated"}
            </span>
            <span className="text-muted-foreground">
              {qualityPolicy.mode} policy · version {qualityPolicy.version ?? "—"}
            </span>
          </div>
          {qualityEvaluation && (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {qualityEvaluation.rubrics.filter((rubric) => rubric.enabled).map((rubric) => (
                <div key={rubric.id} className="flex justify-between gap-3 rounded bg-muted px-2 py-1">
                  <span>{rubric.id.replaceAll("_", " ")}</span>
                  <span>{rubric.passed === null ? "telemetry" : rubric.passed ? "pass" : "fail"}</span>
                </div>
              ))}
            </div>
          )}
          {failedBlockingRubrics.flatMap((rubric) => rubric.findings).map((finding) => (
            <p key={finding} className="text-destructive">{finding}</p>
          ))}
          {qualityEvaluation && qualityEvaluation.claims.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">Claim findings ({qualityEvaluation.claims.length})</summary>
              <div className="mt-2 max-h-52 space-y-2 overflow-auto">
                {qualityEvaluation.claims.map((claim) => (
                  <div key={claim.id} className="rounded border p-2">
                    <p className="font-medium">{claim.classification} · {claim.page}{claim.section ? ` · ${claim.section}` : ""}</p>
                    <p>&ldquo;{claim.exact_text}&rdquo;</p>
                    <p className="text-muted-foreground">{claim.reason} · confidence {claim.confidence.toFixed(2)}{claim.abstained ? " · abstained" : ""}</p>
                    {claim.citations.filter((citation) => /^https?:\/\//.test(citation)).map((citation) => (
                      <a key={citation} href={citation} target="_blank" rel="noreferrer" className="block truncate text-primary underline">{citation}</a>
                    ))}
                    {claim.evidence.map((evidence) => (
                      <p key={`${claim.id}-${evidence.evidence_item_id}`} className="truncate font-mono text-[10px] text-muted-foreground" title={evidence.canonical_uri}>
                        Evidence: {evidence.canonical_uri} · sha256:{evidence.content_hash}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
          {gateBlocked && qualityPolicy.allow_steward_override && canEdit && (
            <label className="block font-medium">
              Required override reason
              <textarea
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Explain why this failed evaluation is safe to promote…"
                className="mt-1 min-h-16 w-full rounded-md border bg-background p-2 font-normal"
              />
            </label>
          )}
          {gateBlocked && !qualityPolicy.allow_steward_override && (
            <p className="text-destructive">Promotion is blocked by the enforced quality policy.</p>
          )}
        </div>
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
