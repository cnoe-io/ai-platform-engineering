"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Database,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SimpleLineChart } from "@/components/admin/SimpleLineChart";
import { DateRangeFilter, DateRangePreset, DateRange, presetToRange } from "@/components/admin/DateRangeFilter";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentCheckpoint {
  name: string;
  checkpoints: number;
  writes: number;
  threads: number;
  latest_checkpoint: string | null;
}

interface PeekEntry {
  agent: string;
  collection: string;
  documents: Record<string, any>[];
}

interface CheckpointStats {
  agents: AgentCheckpoint[];
  totals: {
    total_checkpoints: number;
    total_writes: number;
    total_threads: number;
    active_agents: number;
    total_agents: number;
  };
  daily_activity: Array<{ date: string; writes: number }>;
  cross_contamination: {
    shared_threads: number;
    details: Array<{ thread_id: string; full_thread_id?: string; collections: string[] }>;
  };
  peek_data?: PeekEntry[];
  range: string;
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "\u2014";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format a display name: caipe_supervisor -> Supervisor, aws -> AWS, argocd -> ArgoCD */
function displayName(name: string): string {
  if (name === "caipe_supervisor") return "Supervisor";
  const upper = name.toUpperCase();
  // Known abbreviations
  if (["AWS", "SSH", "NPS"].includes(upper)) return upper;
  // Known compound names
  const compounds: Record<string, string> = {
    argocd: "ArgoCD",
    github: "GitHub",
    gitlab: "GitLab",
    pagerduty: "PagerDuty",
    netutils: "NetUtils",
    victorops: "VictorOps",
  };
  return compounds[name] || name.charAt(0).toUpperCase() + name.slice(1);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CheckpointStatsSection() {
  const [rangePreset, setRangePreset] = useState<DateRangePreset>("7d");
  const [dateRange, setDateRange] = useState<DateRange>(() => presetToRange("7d"));

  const [stats, setStats] = useState<CheckpointStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "checkpoints" | "writes" | "threads">("checkpoints");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedPeek, setExpandedPeek] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
      });
      const res = await fetch(`/api/admin/stats/checkpoints?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setStats(json.data);
    } catch (err: any) {
      setError(err.message || "Failed to load checkpoint stats");
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  const sortedAgents = stats
    ? [...stats.agents].sort((a, b) => {
        const mul = sortAsc ? 1 : -1;
        if (sortBy === "name") return mul * a.name.localeCompare(b.name);
        return mul * ((b[sortBy] as number) - (a[sortBy] as number));
      })
    : [];

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold">Checkpoint Persistence</h3>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter
            value={rangePreset}
            customRange={rangePreset === "custom" ? dateRange : undefined}
            onChange={(preset, range) => {
              setRangePreset(preset);
              setDateRange(range);
            }}
          />
          <Button variant="ghost" size="sm" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && !stats && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading checkpoint stats...</span>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {stats && (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Checkpoints</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats.totals.total_checkpoints)}</p>
                <p className="text-xs text-muted-foreground">count</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Writes</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats.totals.total_writes)}</p>
                <p className="text-xs text-muted-foreground">count</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Active Agents</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  <span className="text-green-500">{stats.totals.active_agents}</span>
                  <span className="text-base text-muted-foreground"> / {stats.totals.total_agents}</span>
                </p>
                <p className="text-xs text-muted-foreground">count</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Unique Threads</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-purple-500">{formatNumber(stats.totals.total_threads)}</p>
                <p className="text-xs text-muted-foreground">count</p>
              </CardContent>
            </Card>
          </div>

          {/* Per-Agent Table */}
          <Card>
            <CardHeader>
              <CardTitle>Per-Agent Checkpoint Status</CardTitle>
              <CardDescription>Click column headers to sort</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th
                        className="pb-2 pr-4 cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("name")}
                      >
                        Agent {sortBy === "name" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                      <th
                        className="pb-2 pr-4 text-right cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("checkpoints")}
                      >
                        Checkpoints {sortBy === "checkpoints" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                      <th
                        className="pb-2 pr-4 text-right cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("writes")}
                      >
                        Writes {sortBy === "writes" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                      <th
                        className="pb-2 pr-4 text-right cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("threads")}
                      >
                        Threads {sortBy === "threads" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                      <th className="pb-2 pr-4 text-right">Last Activity</th>
                      <th className="pb-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgents.map((agent) => (
                      <tr key={agent.name} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 pr-4 font-medium">{displayName(agent.name)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatNumber(agent.checkpoints)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatNumber(agent.writes)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatNumber(agent.threads)}
                        </td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">
                          {timeAgo(agent.latest_checkpoint)}
                        </td>
                        <td className="py-2 text-center">
                          {agent.checkpoints > 0 ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 inline" />
                          ) : (
                            <MinusCircle className="h-4 w-4 text-muted-foreground inline" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                All values are raw counts. Checkpoints and writes reflect total documents in MongoDB.
              </p>
            </CardContent>
          </Card>

          {/* Activity Chart + Cross-Contamination */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Daily Activity Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Checkpoint Writes</CardTitle>
                <CardDescription>Total checkpoint write documents (count)</CardDescription>
              </CardHeader>
              <CardContent>
                {stats.daily_activity.length > 0 ? (
                  <SimpleLineChart
                    data={stats.daily_activity.map((d) => ({
                      label: new Date(d.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      }),
                      value: d.writes,
                    }))}
                    height={200}
                    color="rgb(59, 130, 246)"
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 text-muted-foreground">
                    No activity data
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cross-Contamination */}
            <Card>
              <CardHeader>
                <CardTitle>Collection Isolation</CardTitle>
                <CardDescription>Cross-contamination check</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  {stats.cross_contamination.shared_threads === 0 ? (
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-8 w-8 text-yellow-500" />
                  )}
                  <div>
                    <p className="font-medium">
                      {stats.cross_contamination.shared_threads === 0
                        ? "No cross-contamination detected"
                        : `${stats.cross_contamination.shared_threads} shared thread(s)`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {stats.cross_contamination.shared_threads > 0
                        ? "Shared threads between supervisor and subagent collections are expected (supervisor forwards context_id)"
                        : "Each agent writes exclusively to its own collection pair"}
                    </p>
                  </div>
                </div>

                {stats.cross_contamination.details.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Shared threads:</p>
                    {stats.cross_contamination.details.map((d, i) => (
                      <div key={i} className="text-xs font-mono bg-muted rounded px-2 py-1">
                        <span className="text-muted-foreground">{d.thread_id}</span>
                        <span className="mx-1">&rarr;</span>
                        <span>{d.collections.join(", ")}</span>
                      </div>
                    ))}
                    {stats.cross_contamination.shared_threads > 5 && (
                      <p className="text-xs text-muted-foreground">
                        ...and {stats.cross_contamination.shared_threads - 5} more
                      </p>
                    )}
                  </div>
                )}

                {/* Summary stats */}
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div className="text-center">
                    <p className="text-lg font-bold">{stats.totals.total_agents}</p>
                    <p className="text-xs text-muted-foreground">Collection Pairs</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold">{stats.totals.total_threads}</p>
                    <p className="text-xs text-muted-foreground">Total Threads</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Data Peek — real checkpoint documents */}
          {stats.peek_data && stats.peek_data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Data Peek
                </CardTitle>
                <CardDescription>Latest checkpoint documents per agent (click to expand)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {stats.peek_data.map((peek) => (
                  <div key={peek.agent} className="border rounded">
                    <button
                      onClick={() => setExpandedPeek(expandedPeek === peek.agent ? null : peek.agent)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2">
                        {expandedPeek === peek.agent ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium text-sm">{displayName(peek.agent)}</span>
                        <span className="text-xs text-muted-foreground font-mono">{peek.collection}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {peek.documents.length} doc{peek.documents.length !== 1 ? "s" : ""}
                      </span>
                    </button>
                    {expandedPeek === peek.agent && (
                      <div className="border-t px-3 py-2 space-y-2">
                        {peek.documents.map((doc, idx) => (
                          <div key={idx} className="bg-muted/30 rounded p-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                Document {idx + 1}
                              </span>
                              {doc.thread_id && (
                                <span className="text-xs font-mono text-muted-foreground">
                                  thread: {String(doc.thread_id).substring(0, 12)}...
                                </span>
                              )}
                            </div>
                            <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-60 overflow-auto bg-background rounded p-2 border">
                              {JSON.stringify(doc, null, 2)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
