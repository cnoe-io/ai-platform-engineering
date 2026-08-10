"use client";

// assisted-by claude code claude-opus-4-8

import React, { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Loader2, ShieldCheck, ShieldX, Gauge, Database, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface EngineStats {
  circuitState: "closed" | "open" | "half_open";
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
}
interface DecisionStats {
  total: number;
  allow: number;
  deny: number;
  denyRate: number;
  byReason: { reason: string; count: number }[];
  topDenied: { resource: string; count: number }[];
}
interface StatsResponse {
  engine: EngineStats;
  decisions: DecisionStats | null;
  window: string;
  persistence: boolean;
}

const WINDOW_OPTIONS = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function CircuitBadge({ state }: { state: EngineStats["circuitState"] }) {
  if (state === "closed")
    return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950 gap-1"><Zap className="h-3 w-3" />Closed (healthy)</Badge>;
  if (state === "half_open")
    return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 gap-1"><Zap className="h-3 w-3" />Half-open (probing)</Badge>;
  return <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950 gap-1"><Zap className="h-3 w-3" />Open (failing closed)</Badge>;
}

function StatCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle?: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export function CasInsightsTab({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState("24h");

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/authz/stats?window=${windowKey}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData((await res.json()) as StatsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load CAS stats");
    } finally {
      setLoading(false);
    }
  }, [windowKey]);

  useEffect(() => {
    if (isAdmin) void fetchStats();
  }, [isAdmin, fetchStats]);

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Admin access required.</p>;
  }

  const engine = data?.engine;
  const decisions = data?.decisions;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2"><Activity className="h-5 w-5" />Centralized Authorization Service</h3>
          <p className="text-sm text-muted-foreground">Authorization service health &amp; decision statistics.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowKey}
            onChange={(e) => setWindowKey(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => void fetchStats()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Live engine health (per-replica) */}
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Adapter health (live, this replica)</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Circuit breaker</CardTitle>
              <Gauge className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>{engine ? <CircuitBadge state={engine.circuitState} /> : <span className="text-muted-foreground">—</span>}</CardContent>
          </Card>
          <StatCard
            title="Cache hit ratio"
            value={engine ? pct(engine.cacheHitRatio) : "—"}
            subtitle={engine ? `${engine.cacheHits} hits / ${engine.cacheMisses} misses` : undefined}
            icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          />
          <StatCard
            title="Cached decisions"
            value={engine ? String(engine.cacheSize) : "—"}
            subtitle="entries held this replica"
            icon={<Database className="h-4 w-4 text-muted-foreground" />}
          />
        </div>
      </div>

      {/* Durable decision stats */}
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Decisions ({data?.window ?? windowKey})</p>
        {!data?.persistence ? (
          <Card><CardContent className="py-4 text-sm text-muted-foreground">MongoDB is not configured — decision history is unavailable. Live adapter health above still applies.</CardContent></Card>
        ) : decisions ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard title="Total decisions" value={String(decisions.total)} icon={<Activity className="h-4 w-4 text-muted-foreground" />} />
              <StatCard title="Allowed" value={String(decisions.allow)} icon={<ShieldCheck className="h-4 w-4 text-green-600" />} />
              <StatCard title="Denied" value={String(decisions.deny)} subtitle={`${pct(decisions.denyRate)} deny rate`} icon={<ShieldX className="h-4 w-4 text-red-600" />} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">By reason</CardTitle><CardDescription>Decision outcomes grouped by reason code</CardDescription></CardHeader>
                <CardContent className="space-y-1">
                  {decisions.byReason.length === 0 ? <p className="text-sm text-muted-foreground">No decisions in window.</p> :
                    decisions.byReason.map((r) => (
                      <div key={r.reason} className="flex items-center justify-between text-sm">
                        <span className="font-mono">{r.reason}</span>
                        <Badge variant="outline">{r.count}</Badge>
                      </div>
                    ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Top denied resources</CardTitle><CardDescription>Most-denied resources in window</CardDescription></CardHeader>
                <CardContent className="space-y-1">
                  {decisions.topDenied.length === 0 ? <p className="text-sm text-muted-foreground">No denials in window.</p> :
                    decisions.topDenied.map((r) => (
                      <div key={r.resource} className="flex items-center justify-between text-sm">
                        <span className="font-mono truncate mr-2">{r.resource}</span>
                        <Badge variant="outline" className="text-red-600 border-red-300">{r.count}</Badge>
                      </div>
                    ))}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
