"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  RefreshCw,
  Shield,
  Wrench,
  GitBranch,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { UnifiedAuditEvent, AuditEventType, UnifiedAuditOutcome } from "@/lib/rbac/types";

interface UnifiedAuditTabProps {
  isAdmin: boolean;
}

interface PaginatedResult {
  records: UnifiedAuditEvent[];
  total: number;
  page: number;
  limit: number;
}

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All types" },
  { value: "auth", label: "Authorization" },
  { value: "tool_action", label: "Tool Action" },
  { value: "agent_delegation", label: "Agent Delegation" },
];

const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All outcomes" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
];

function TypeBadge({ type }: { type: AuditEventType }) {
  switch (type) {
    case "auth":
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800 gap-1">
          <Shield className="h-3 w-3" />
          Auth
        </Badge>
      );
    case "tool_action":
      return (
        <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800 gap-1">
          <Wrench className="h-3 w-3" />
          Tool
        </Badge>
      );
    case "agent_delegation":
      return (
        <Badge variant="outline" className="text-purple-600 border-purple-300 bg-purple-50 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-800 gap-1">
          <GitBranch className="h-3 w-3" />
          Delegation
        </Badge>
      );
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

function OutcomeBadge({ outcome }: { outcome: UnifiedAuditOutcome }) {
  switch (outcome) {
    case "allow":
    case "success":
      return (
        <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950 dark:text-green-400 dark:border-green-800">
          {outcome}
        </Badge>
      );
    case "deny":
    case "error":
      return (
        <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950 dark:text-red-400 dark:border-red-800">
          {outcome}
        </Badge>
      );
    default:
      return <Badge variant="outline">{outcome}</Badge>;
  }
}

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function UnifiedAuditTab({ isAdmin }: UnifiedAuditTabProps) {
  const [result, setResult] = useState<PaginatedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [typeFilter, setTypeFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [agentName, setAgentName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEvents = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("limit", "30");
      if (typeFilter) params.set("type", typeFilter);
      if (outcomeFilter) params.set("outcome", outcomeFilter);
      if (userEmail.trim()) params.set("user_email", userEmail.trim());
      if (agentName.trim()) params.set("agent_name", agentName.trim());
      if (dateFrom) params.set("from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("to", new Date(dateTo).toISOString());

      const res = await fetch(`/api/admin/audit-events?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      const data: PaginatedResult = await res.json();
      setResult(data);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit events");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, outcomeFilter, userEmail, agentName, dateFrom, dateTo]);

  useEffect(() => {
    fetchEvents(1);
  }, [fetchEvents]);

  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(() => fetchEvents(page), 30_000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, page, fetchEvents]);

  const totalPages = result ? Math.ceil(result.total / result.limit) : 0;

  const handleReset = () => {
    setTypeFilter("");
    setOutcomeFilter("");
    setUserEmail("");
    setAgentName("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Admin access required to view audit events.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Action Audit Log</CardTitle>
            <CardDescription>
              Unified view of authorization decisions, tool invocations, and agent delegations
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} />
              {autoRefresh ? "Auto" : "Auto"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchEvents(page)} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Input
            placeholder="User email..."
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            className="h-9 w-48"
          />
          <Input
            placeholder="Agent name..."
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            className="h-9 w-40"
          />
          <Input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 w-44"
            title="From"
          />
          <Input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 w-44"
            title="To"
          />
          <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 h-9">
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button variant="default" size="sm" onClick={() => fetchEvents(1)} className="gap-1 h-9">
            <Search className="h-3.5 w-3.5" />
            Search
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3 mb-4">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !result && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Table */}
        {result && (
          <>
            <div className="text-xs text-muted-foreground mb-2">
              {result.total} event{result.total !== 1 ? "s" : ""} found
              {loading && <Loader2 className="inline h-3 w-3 ml-1 animate-spin" />}
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-2 font-medium w-8" />
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {result.records.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                        No audit events found for the selected filters.
                      </td>
                    </tr>
                  )}
                  {result.records.map((evt) => {
                    const rowKey = `${evt.correlation_id}-${evt.ts}`;
                    const isExpanded = expandedRow === rowKey;
                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                        >
                          <td className="px-3 py-2">
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(evt.ts)}
                          </td>
                          <td className="px-3 py-2">
                            <TypeBadge type={evt.type} />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs max-w-[200px] truncate" title={evt.action}>
                            {evt.action}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {evt.agent_name || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={evt.user_email || evt.subject_hash}>
                            {evt.user_email || <span className="text-muted-foreground">{evt.subject_hash.slice(0, 16) + "…"}</span>}
                          </td>
                          <td className="px-3 py-2">
                            <OutcomeBadge outcome={evt.outcome} />
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {evt.duration_ms != null && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDuration(evt.duration_ms)}
                              </span>
                            )}
                            {evt.duration_ms == null && "—"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t bg-muted/20">
                            <td colSpan={8} className="px-6 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                                <DetailField label="Correlation ID" value={evt.correlation_id} />
                                <DetailField label="Context ID" value={evt.context_id} />
                                <DetailField label="Component" value={evt.component} />
                                <DetailField label="Source" value={evt.source} />
                                <DetailField label="Tool" value={evt.tool_name} />
                                <DetailField label="PDP" value={evt.pdp} />
                                <DetailField label="Reason Code" value={evt.reason_code} />
                                <DetailField label="Resource Ref" value={evt.resource_ref} />
                                <DetailField label="Subject Hash" value={evt.subject_hash} mono />
                                <DetailField label="Tenant" value={evt.tenant_id} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => fetchEvents(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => fetchEvents(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className={mono ? "font-mono break-all" : ""}>{value}</span>
    </div>
  );
}
