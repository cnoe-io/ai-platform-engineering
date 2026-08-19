"use client";

import React, { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const PAGE_SIZE = 20;

interface AutomatableAgent {
  id: string;
  name: string;
  owner_team_slug: string | null;
  autonomous_enabled: boolean;
}

interface AgentAutomationPanelProps {
  /**
   * Fired after a successful enable/disable. Enabling an agent makes it
   * schedulable (and disabling un-schedules it), so the owning page uses this
   * to refresh its task sections without a remount.
   */
  onChanged?: () => void;
}

/**
 * Layer 2 enablement -- writes/deletes `team:<slug>#member -> automator ->
 * agent:<id>` through the unchanged automation route. Previously lived as a
 * pill on each Agents-page row; it belongs here because enabling autonomous
 * is a team-admin decision about automation, not part of agent configuration.
 */
export function AgentAutomationPanel({ onChanged }: AgentAutomationPanelProps = {}) {
  const { toast } = useToast();
  const [agents, setAgents] = useState<AutomatableAgent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const fetchAgents = useCallback(async (nextPage: number, nextSearch: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        page_size: String(PAGE_SIZE),
      });
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      const response = await fetch(`/api/autonomous/agents?${params.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        data?: { automatable?: AutomatableAgent[]; automatable_total?: number };
      };
      setAgents(body.data?.automatable ?? []);
      setTotal(body.data?.automatable_total ?? 0);
      setPage(nextPage);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load agents.");
      setAgents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search, matching the admin dialogs' 250ms convention.
  useEffect(() => {
    const handle = setTimeout(() => {
      void fetchAgents(1, search);
    }, 250);
    return () => clearTimeout(handle);
  }, [search, fetchAgents]);

  const setRowError = (agentId: string, message: string | null) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[agentId] = message;
      else delete next[agentId];
      return next;
    });
  };

  const handleToggle = async (agent: AutomatableAgent) => {
    if (!agent.owner_team_slug) {
      setRowError(agent.id, "This agent has no owner team; autonomous scheduling requires one.");
      return;
    }
    const next = !agent.autonomous_enabled;
    setRowError(agent.id, null);
    setBusyIds((prev) => new Set(prev).add(agent.id));
    // Optimistic flip so the switch responds immediately; reverted on failure.
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, autonomous_enabled: next } : a)),
    );

    try {
      const response = await fetch(`/api/dynamic-agents/agents/${agent.id}/automation`, {
        method: next ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_slug: agent.owner_team_slug }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        setAgents((prev) =>
          prev.map((a) => (a.id === agent.id ? { ...a, autonomous_enabled: !next } : a)),
        );
        if (response.status === 409) {
          setRowError(
            agent.id,
            `${agent.owner_team_slug} isn't autonomous-eligible; a platform admin must enable it in Admin → Teams.`,
          );
        } else {
          setRowError(agent.id, data.error || `HTTP ${response.status}`);
        }
        return;
      }
      if (!next) {
        toast(
          `Autonomous disabled for "${agent.name}". Its tasks are paused and will not resume automatically.`,
          "success",
        );
      }
      onChanged?.();
    } catch (err) {
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, autonomous_enabled: !next } : a)),
      );
      setRowError(
        agent.id,
        err instanceof Error ? err.message : "Failed to update autonomous setting.",
      );
    } finally {
      setBusyIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(agent.id);
        return nextSet;
      });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Enabling autonomous lets members of the agent&apos;s owner team schedule tasks against it.
        Disabling pauses that agent&apos;s existing tasks; they are not resumed automatically.
      </p>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search agents…"
        aria-label="Search agents"
        className="max-w-sm"
      />

      {loadError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <span>{loadError}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => fetchAgents(page, search)}>
            Retry
          </Button>
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "No agents to manage."}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {agents.map((agent) => (
            <li key={agent.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{agent.name}</span>
                  {agent.owner_team_slug && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {agent.owner_team_slug}
                    </Badge>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={agent.autonomous_enabled}
                  aria-label={`Autonomous for ${agent.name}`}
                  disabled={busyIds.has(agent.id)}
                  onClick={() => handleToggle(agent)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    agent.autonomous_enabled ? "bg-violet-600" : "bg-muted"
                  }`}
                >
                  {/* Anchor the knob to the left edge explicitly. Without
                      `left-0.5` it inherits the button's centred static
                      position, so the "off" state renders mid-track and the
                      toggle reads as travelling the wrong way. */}
                  <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      agent.autonomous_enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {rowErrors[agent.id] && (
                <p className="mt-1 text-xs text-destructive">{rowErrors[agent.id]}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => fetchAgents(page - 1, search)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => fetchAgents(page + 1, search)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
