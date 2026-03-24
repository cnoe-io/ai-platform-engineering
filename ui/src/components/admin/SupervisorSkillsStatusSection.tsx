"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw, Cpu } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SkillsStatus {
  mas_registered?: boolean;
  graph_generation?: number | null;
  skills_loaded_count?: number | null;
  skills_merged_at?: string | null;
  catalog_cache_generation?: number | null;
  message?: string;
}

interface SupervisorSkillsStatusSectionProps {
  isAdmin: boolean;
}

export function SupervisorSkillsStatusSection({ isAdmin }: SupervisorSkillsStatusSectionProps) {
  const [status, setStatus] = useState<SkillsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/skills/supervisor-status");
      if (res.status === 403) {
        setError("Admin access required.");
        return;
      }
      if (!res.ok) {
        setError(`Failed to load status (${res.status})`);
        return;
      }
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load supervisor skills status");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleRefreshSupervisor = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/refresh", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.error || `Refresh failed (${res.status})`);
        return;
      }
      await loadStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Refresh request failed");
    } finally {
      setRefreshing(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Supervisor skills load
          </CardTitle>
          <CardDescription>
            In-process supervisor snapshot after last graph build (FR-016). Use Refresh to invalidate catalog cache
            and rebuild the supervisor graph when hubs or skills change.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshSupervisor}
          disabled={refreshing}
          className="gap-1 shrink-0"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          Rebuild supervisor
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {error && <p className="text-destructive text-xs">{error}</p>}
        {status?.message && !status.mas_registered && (
          <p className="text-muted-foreground text-xs">{status.message}</p>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-muted-foreground">MAS registered</div>
          <div>{status?.mas_registered ? "yes" : "no"}</div>
          <div className="text-muted-foreground">Graph generation</div>
          <div>{status?.graph_generation ?? "—"}</div>
          <div className="text-muted-foreground">Skills loaded</div>
          <div>{status?.skills_loaded_count ?? "—"}</div>
          <div className="text-muted-foreground">Last merge (UTC)</div>
          <div className="break-all">{status?.skills_merged_at ?? "—"}</div>
          <div className="text-muted-foreground">Catalog cache gen</div>
          <div>{status?.catalog_cache_generation ?? "—"}</div>
        </div>
        <Button variant="ghost" size="sm" className="text-xs h-8 mt-2" onClick={() => loadStatus()}>
          Reload status
        </Button>
      </CardContent>
    </Card>
  );
}
