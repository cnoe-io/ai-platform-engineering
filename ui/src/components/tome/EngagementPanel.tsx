"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, FileText, HardDrive, MessageCircle, RefreshCw, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TomeLoading } from "@/components/tome/TomeLoading";
import { formatBytes, formatTimeAgo, formatTokens } from "@/lib/tome/format";
import { cn } from "@/lib/utils";

/**
 * This project's own chat engagement + ingestion/consumption snapshot.
 * Deliberately scoped to one project — no cross-project engagement rollup
 * exists; the org-wide TOME Admin analytics tab covers ingestion/size only.
 */

interface Engagement {
  distinctChatters: number;
  totalSessions: number;
  totalMessages: number;
  lastMessageAt: string | null;
}

interface Consumption {
  pageCount: number;
  wikiSizeBytes: number;
  lastIngestedAt: string | null;
  activeIngest: { status: "queued" | "running"; mode: "ingest" | "bhag_rollup" } | null;
  ingestRunsSucceeded: number;
  tokenUsage: { input: number; output: number };
}

interface EngagementResponse {
  engagement: Engagement;
  consumption: Consumption;
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function EngagementPanel({ slug }: { slug: string }) {
  const [data, setData] = useState<EngagementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/engagement`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || `Failed to load (${res.status})`);
      setData(body?.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <TomeLoading variant="list" />;
  }

  const engagement = data?.engagement;
  const consumption = data?.consumption;
  const activeIngest = consumption?.activeIngest;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-5 w-5" />
            Insights
          </h2>
          <p className="text-sm text-muted-foreground">
            How this project&apos;s wiki and chat are being used.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Engagement</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={<Users className="h-3.5 w-3.5" />}
            label="Chatters"
            value={String(engagement?.distinctChatters ?? 0)}
            sub={`${engagement?.totalSessions ?? 0} session${engagement?.totalSessions === 1 ? "" : "s"}`}
          />
          <StatCard
            icon={<MessageCircle className="h-3.5 w-3.5" />}
            label="Messages"
            value={String(engagement?.totalMessages ?? 0)}
          />
          <StatCard
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Last active"
            value={formatTimeAgo(engagement?.lastMessageAt)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Consumption</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={<FileText className="h-3.5 w-3.5" />}
            label="Pages"
            value={String(consumption?.pageCount ?? 0)}
          />
          <StatCard
            icon={<HardDrive className="h-3.5 w-3.5" />}
            label="Wiki size"
            value={formatBytes(consumption?.wikiSizeBytes ?? 0)}
            sub={
              consumption && (consumption.tokenUsage.input || consumption.tokenUsage.output)
                ? `${formatTokens(consumption.tokenUsage.input + consumption.tokenUsage.output)} tokens ingested`
                : undefined
            }
          />
          <StatCard
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Ingestion"
            value={
              activeIngest
                ? activeIngest.status === "running"
                  ? "Running"
                  : "Queued"
                : formatTimeAgo(consumption?.lastIngestedAt)
            }
            sub={
              activeIngest
                ? activeIngest.mode === "bhag_rollup"
                  ? "Synthesizing"
                  : "Ingesting"
                : consumption?.ingestRunsSucceeded
                  ? `${consumption.ingestRunsSucceeded} run${consumption.ingestRunsSucceeded === 1 ? "" : "s"} total`
                  : "No ingests yet"
            }
          />
        </div>
      </section>
    </div>
  );
}
