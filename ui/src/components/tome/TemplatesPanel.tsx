"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/tome/PanelHeader";
import { TomeLoading } from "@/components/tome/TomeLoading";
import type { PageDrift } from "@/lib/tome/template-drift";
import { cn } from "@/lib/utils";

/**
 * "Check for template drift" (#508): its own tab, not folded into the
 * ingest panel. Runs automatically on open (a passive health check the
 * user shouldn't have to remember to trigger); the button just re-runs it.
 * Read-only, every reader (not just the data steward) can see it. Resolving
 * a flagged page happens through a normal scoped ingest (#487), not here.
 */

interface Props {
  slug: string;
  onNavigate: (path: string) => void;
}

const STATUS_LABEL: Record<PageDrift["status"], string> = {
  missing: "missing",
  unbound: "not from a template",
  version_behind: "behind",
  current: "current",
};

function statusClassName(p: PageDrift): string {
  if (p.status === "current") return "bg-emerald-950/30 text-emerald-400";
  if (p.status === "missing") return "bg-destructive/10 text-destructive";
  if (p.status === "unbound") return "bg-muted text-muted-foreground";
  // version_behind
  return p.drifted ? "bg-amber-950/30 text-amber-400" : "bg-muted text-muted-foreground";
}

function statusLabel(p: PageDrift): string {
  if (p.status !== "version_behind") return STATUS_LABEL[p.status];
  if (p.drifted === true) return "drifted";
  if (p.drifted === false) return "behind (content ok)";
  return "behind (unchecked)";
}

export function TemplatesPanel({ slug, onNavigate }: Props) {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<PageDrift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/template-drift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || `template drift check failed (${res.status})`);
      }
      setReport(json.data.pages as PageDrift[]);
      setCheckedAt(new Date());
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setChecking(false);
    }
  }, [slug]);

  useEffect(() => {
    void check();
  }, [check]);

  const flagged = report?.filter((p) => p.status !== "current") ?? [];

  return (
    <PanelShell
      title="Template drift"
      description="Whether this wiki's pages still match the current page-template config: which pages are missing, unbound, behind, or drifted. Read-only; run an ingest to resolve anything flagged here."
      action={
        <Button size="sm" variant="outline" onClick={() => void check()} disabled={checking}>
          <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
          Recheck
        </Button>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {checking && !report ? (
        <TomeLoading variant="list" rows={4} />
      ) : (
        report && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {checkedAt && `Checked ${checkedAt.toLocaleTimeString()}. `}
              {report.length} template-related page{report.length === 1 ? "" : "s"}, {flagged.length}{" "}
              not current.
            </p>
            {report.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No template-bound pages found. Run an ingest first.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {report.map((p) => (
                  <li key={p.path} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                        statusClassName(p),
                      )}
                    >
                      {statusLabel(p)}
                    </span>
                    <span className="flex-1">
                      {p.status === "missing" ? (
                        <span className="font-mono text-muted-foreground">{p.path}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onNavigate(p.path)}
                          className="font-mono hover:underline"
                        >
                          {p.path}
                        </button>
                      )}
                      {p.reason && (
                        <span className="ml-1.5 text-xs text-muted-foreground">: {p.reason}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}
    </PanelShell>
  );
}
