"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MigrationComparisonSummary as Summary } from "@/lib/authz/comparison-summary";
import { AlertTriangle, CheckCircle2, GitCompareArrows, Loader2, XCircle } from "lucide-react";

export function MigrationComparisonSummary({
  summary,
  loading,
  error,
}: {
  summary: Summary | null;
  loading: boolean;
  error?: string | null;
}) {
  return (
    <Card className="mb-4 border-amber-500/30 bg-amber-500/[0.03]" data-testid="migration-comparison-summary">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompareArrows className="h-4 w-4" />
              Legacy versus caipe-authz
            </CardTitle>
            <CardDescription>
              Traffic evidence for the selected window and comparison filters.
            </CardDescription>
          </div>
          {loading ? (
            <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Loading</Badge>
          ) : summary?.evidence_ready ? (
            <Badge className="bg-emerald-600">Traffic evidence ready</Badge>
          ) : (
            <Badge variant="destructive">Traffic evidence blocked</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />{error}
          </div>
        ) : summary ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Comparisons" value={summary.comparison_count.toLocaleString()} />
              <Metric label="Semantic mismatches" value={summary.semantic_mismatch_count.toLocaleString()} />
              <Metric label="Provider error rate" value={`${(summary.provider_error_rate * 100).toFixed(3)}%`} />
              <Metric label="Authz p99" value={`${summary.p99_authz_latency_ms.toFixed(1)} ms`} />
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {summary.gates.map((gate) => (
                <div key={gate.id} className="flex items-start gap-2 rounded-md border bg-background/70 p-2.5">
                  {gate.passed ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div>
                    <div className="text-sm font-medium">{gate.label}</div>
                    <div className="text-xs text-muted-foreground">{gate.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Revision: {summary.latest_rollout_revision ?? "not reported"}</span>
              <span>Authority: {formatCounts(summary.authoritative_counts)}</span>
              <span>Mismatches: {formatCounts(summary.mismatch_counts)}</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              This panel evaluates traffic evidence only. Model descriptor, audit backlog, owner, and rollback-drill gates
              must also pass in the caipe-authz promotion endpoint before changing authority.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatCounts(values: Record<string, number>): string {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([key, value]) => `${key} ${value}`).join(" · ") : "none";
}
