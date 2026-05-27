"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw, Cpu, CheckCircle2, XCircle, AlertCircle, HelpCircle, Copy, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

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

  const isConnected = status?.mas_registered === true;
  const hasSkills = (status?.skills_loaded_count ?? 0) > 0;
  const isNotReachable = !isConnected && !!status?.message;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Supervisor Skills
          </CardTitle>
          <CardDescription>
            Skills loaded into the supervisor agent graph. Rebuild to pick up hub or catalog changes.
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
          {refreshing ? "Rebuilding..." : "Rebuild"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {isNotReachable && !error ? (
          <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0 text-orange-500" />
            {status.message}
          </div>
        ) : null}

        {/* Status badges */}
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className={
              isConnected
                ? "text-green-500 border-green-500/30 gap-1"
                : "text-muted-foreground border-border gap-1"
            }
          >
            {isConnected ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            {isConnected ? "Connected" : "Not connected"}
          </Badge>
          {!isConnected && (
            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Why is the supervisor not connected?"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
          {isConnected && (
            <>
              <Badge variant="outline" className="gap-1 text-muted-foreground border-border">
                {status?.skills_loaded_count ?? 0} skills loaded
              </Badge>
              {status?.graph_generation != null && (
                <Badge variant="outline" className="gap-1 text-muted-foreground border-border">
                  Graph gen {status.graph_generation}
                </Badge>
              )}
              {status?.catalog_cache_generation != null && (
                <Badge variant="outline" className="gap-1 text-muted-foreground border-border">
                  Cache gen {status.catalog_cache_generation}
                </Badge>
              )}
            </>
          )}
        </div>

        {/* Help panel — clickable, selectable text */}
        {!isConnected && showHelp && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium text-foreground">The supervisor is not reachable. Check that:</p>
              <button
                type="button"
                onClick={() => copyText(
                  "The supervisor is not reachable. Check that:\n\n" +
                  "1. BACKEND_SKILLS_URL is set, e.g.\n" +
                  "   BACKEND_SKILLS_URL=http://localhost:8000\n\n" +
                  "2. The supervisor process is running at that URL\n\n" +
                  "3. It exposes /internal/supervisor/skills-status\n" +
                  "   curl -sS http://localhost:8000/internal/supervisor/skills-status\n\n" +
                  "For local dev, add to ui/.env.local and restart the dev server."
                )}
                className="p-1 rounded hover:bg-muted-foreground/20 transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Copy all"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="text-[11px]">{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <ol className="ml-4 list-decimal space-y-2">
              <li>
                <code className="px-1 py-0.5 rounded bg-muted text-[11px]">BACKEND_SKILLS_URL</code> is set, e.g.{" "}
                <code className="px-1.5 py-0.5 rounded bg-muted text-[11px]">BACKEND_SKILLS_URL=http://localhost:8000</code>
              </li>
              <li>The supervisor process is running at that URL</li>
              <li>
                It exposes{" "}
                <code className="px-1 py-0.5 rounded bg-muted text-[11px]">/internal/supervisor/skills-status</code>
              </li>
            </ol>
            <p className="pt-1">
              For local dev, add to <code className="px-1 py-0.5 rounded bg-muted text-[11px]">ui/.env.local</code> and restart the dev server.
            </p>
          </div>
        )}

        {/* Details — only show when connected and has data */}
        {isConnected && hasSkills && status?.skills_merged_at && (
          <div className="text-xs text-muted-foreground">
            Last merged: {new Date(status.skills_merged_at).toLocaleString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
