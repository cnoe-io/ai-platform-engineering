"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  RefreshCw,
  Pencil,
  X,
  Check,
  Network,
  HardDrive,
  Loader2,
  ChevronDown,
  ChevronRight,
  Activity,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NetworkRule {
  name: string;
  endpoints: Array<{
    host: string;
    port?: number;
    protocol?: string;
    enforcement?: string;
  }>;
  binaries?: Array<{ path: string }>;
  _temporary?: boolean;
}

interface PolicyData {
  version?: number;
  filesystem_policy?: {
    include_workdir?: boolean;
    read_only?: string[];
    read_write?: string[];
  };
  network_policies?: Record<string, NetworkRule>;
}

interface SandboxAgent {
  _id: string;
  name: string;
  sandbox: {
    enabled: boolean;
    sandbox_name?: string;
    policy_template?: string;
  };
  enabled: boolean;
}

interface AgentPolicyState {
  loading: boolean;
  policy: PolicyData | null;
  policyYaml: string;
  editing: boolean;
  editYaml: string;
  saving: boolean;
  error: string | null;
  statusText: string | null;
  sandboxStatus: {
    phase?: string;
    connected?: boolean;
    policy_loaded?: boolean;
    policy_status?: string;
    policy_error?: string;
    sandbox_error?: string;
  } | null;
  expanded: boolean;
}

function AgentPolicySection({
  agent,
  state,
  onRefresh,
  onEdit,
  onSave,
  onCancelEdit,
  onEditYamlChange,
  onRemoveRule,
  onToggleExpand,
}: {
  agent: SandboxAgent;
  state: AgentPolicyState;
  onRefresh: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onEditYamlChange: (yaml: string) => void;
  onRemoveRule: (ruleId: string) => void;
  onToggleExpand: () => void;
}) {
  const networkRules = state.policy?.network_policies
    ? Object.entries(state.policy.network_policies)
    : [];
  const readWritePaths = state.policy?.filesystem_policy?.read_write || [];
  const readOnlyPaths = state.policy?.filesystem_policy?.read_only || [];

  const policyFailed =
    state.sandboxStatus?.policy_status === "failed" ||
    !!state.sandboxStatus?.policy_error;

  const phaseColor =
    policyFailed
      ? "text-amber-500"
      : state.sandboxStatus?.phase === "ready"
      ? "text-green-500"
      : state.sandboxStatus?.phase === "error"
      ? "text-red-500"
      : "text-blue-500";

  const PhaseIcon =
    policyFailed
      ? ShieldAlert
      : state.sandboxStatus?.phase === "ready"
      ? ShieldCheck
      : state.sandboxStatus?.phase === "error"
      ? ShieldX
      : Shield;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      {/* Agent header row */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
      >
        {state.expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <PhaseIcon className={cn("h-4 w-4 shrink-0", phaseColor)} />

        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{agent.name}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {agent._id}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {state.sandboxStatus?.phase && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                policyFailed
                  ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                  : state.sandboxStatus.phase === "ready"
                  ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
                  : state.sandboxStatus.phase === "error"
                  ? "bg-red-500/10 text-red-500 border-red-500/30"
                  : "bg-blue-500/10 text-blue-500 border-blue-500/30"
              )}
            >
              {policyFailed
                ? "policy failed"
                : state.sandboxStatus.phase}
            </Badge>
          )}
          {!agent.enabled && (
            <Badge variant="secondary" className="text-[10px]">
              disabled
            </Badge>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {state.expanded && (
        <div className="border-t border-border/40 px-4 py-3 space-y-3">
          {/* Policy / sandbox error banner */}
          {(state.sandboxStatus?.policy_error || state.sandboxStatus?.sandbox_error || state.error) && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400 flex items-start gap-2">
              <ShieldX className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                {state.sandboxStatus?.policy_error && (
                  <p><span className="font-medium">Policy error:</span> {state.sandboxStatus.policy_error}</p>
                )}
                {state.sandboxStatus?.sandbox_error && (
                  <p><span className="font-medium">Sandbox error:</span> {state.sandboxStatus.sandbox_error}</p>
                )}
                {state.error && (
                  <p>{state.error}</p>
                )}
              </div>
            </div>
          )}

          {state.loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading policy…
            </div>
          ) : !state.policy ? (
            <div className="text-center text-muted-foreground text-sm py-4">
              <Shield className="h-6 w-6 mx-auto mb-1 opacity-40" />
              <p>Sandbox not provisioned yet.</p>
              <p className="text-xs mt-1">Start a chat to initialize the sandbox.</p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {state.sandboxStatus && (
                    <span className={cn(
                      state.sandboxStatus.policy_status === "failed" && "text-red-400",
                      state.sandboxStatus.policy_status === "loaded" && "text-green-400",
                    )}>
                      Policy:{" "}
                      {state.sandboxStatus.policy_status || (state.sandboxStatus.policy_loaded ? "loaded" : "not loaded")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onRefresh}
                    title="Refresh policy"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onEdit}
                    title="Edit policy YAML"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Status messages */}
              {state.statusText && (
                <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  {state.statusText}
                </div>
              )}
              {state.error && (
                <div className="text-xs text-destructive">{state.error}</div>
              )}

              {/* Edit mode */}
              {state.editing ? (
                <div className="space-y-2">
                  <textarea
                    value={state.editYaml}
                    onChange={(e) => onEditYamlChange(e.target.value)}
                    className="w-full h-72 font-mono text-xs p-3 rounded border bg-muted/50 resize-y"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={onSave}
                      disabled={state.saving}
                    >
                      {state.saving && (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      )}
                      Save & Hot Reload
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onCancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Network Rules */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Network className="h-3.5 w-3.5" />
                      <span>Network Rules ({networkRules.length})</span>
                    </div>
                    {networkRules.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic pl-5">
                        No network access allowed
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {networkRules.map(([ruleId, rule]) => (
                          <div
                            key={ruleId}
                            className={cn(
                              "flex items-center justify-between px-2.5 py-1.5 rounded text-xs border",
                              rule._temporary
                                ? "border-amber-500/30 bg-amber-500/5"
                                : "border-border/50 bg-muted/30"
                            )}
                          >
                            <div className="min-w-0">
                              <span className="font-medium">
                                {rule.name || ruleId}
                              </span>
                              {rule.endpoints?.[0] && (
                                <span className="text-muted-foreground ml-1.5 font-mono">
                                  {rule.endpoints[0].host}:
                                  {rule.endpoints[0].port || 443}
                                </span>
                              )}
                              {rule._temporary && (
                                <span className="text-amber-600 dark:text-amber-400 ml-1">
                                  (temp)
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => onRemoveRule(ruleId)}
                              className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                              title="Remove rule"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Filesystem */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <HardDrive className="h-3.5 w-3.5" />
                      <span>Filesystem</span>
                    </div>
                    <div className="text-xs space-y-0.5 pl-5">
                      {readWritePaths.length > 0 && (
                        <p>
                          <span className="text-green-600 dark:text-green-400">
                            RW:
                          </span>{" "}
                          {readWritePaths.join(", ")}
                        </p>
                      )}
                      {readOnlyPaths.length > 0 && (
                        <p>
                          <span className="text-muted-foreground">RO:</span>{" "}
                          {readOnlyPaths.slice(0, 5).join(", ")}
                          {readOnlyPaths.length > 5 &&
                            ` +${readOnlyPaths.length - 5} more`}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface StreamEntry {
  id: string;
  timestamp: Date;
  agentId: string;
  kind: "denial" | "policy_update" | "connected";
  label: string;
  detail?: string;
  severity: "error" | "success" | "info";
}

function EventStreamPanel({ agentIds }: { agentIds: string[] }) {
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    const sources = sourcesRef.current;
    for (const agentId of agentIds) {
      if (sources.has(agentId)) continue;

      const es = new EventSource(
        `/api/dynamic-agents/sandbox/events/${agentId}`
      );

      es.addEventListener("connected", () => {
        setConnected((prev) => new Set([...prev, agentId]));
        setEntries((prev) => [
          ...prev,
          {
            id: `conn-${agentId}-${Date.now()}`,
            timestamp: new Date(),
            agentId,
            kind: "connected",
            label: `Connected to ${agentId}`,
            severity: "info",
          },
        ]);
      });

      es.addEventListener("sandbox_denial", (e) => {
        try {
          const data = JSON.parse(e.data);
          const stageLabel =
            data.stage === "l4_deny" ? "L4" :
            data.stage === "l7_deny" ? "L7" :
            data.stage === "l7_audit" ? "L7 Audit" :
            data.stage === "ssrf" ? "SSRF" :
            data.stage || "Deny";

          setEntries((prev) => [
            ...prev,
            {
              id: `deny-${agentId}-${Date.now()}-${Math.random()}`,
              timestamp: new Date(),
              agentId,
              kind: "denial",
              label: `${stageLabel} blocked → ${data.host || "?"}:${data.port || "?"}`,
              detail: data.reason || data.binary || undefined,
              severity: "error",
            },
          ]);
        } catch { /* skip malformed */ }
      });

      es.addEventListener("policy_update", (e) => {
        try {
          const data = JSON.parse(e.data);
          setEntries((prev) => [
            ...prev,
            {
              id: `pol-${agentId}-${Date.now()}`,
              timestamp: new Date(),
              agentId,
              kind: "policy_update",
              label: `Policy ${data.status}${data.rule_id ? ` (${data.rule_id})` : ""}`,
              severity: data.status === "loaded" ? "success" : "error",
            },
          ]);
        } catch { /* skip malformed */ }
      });

      es.onerror = () => {
        setConnected((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
      };

      sources.set(agentId, es);
    }

    return () => {
      for (const [, es] of sources) {
        es.close();
      }
      sources.clear();
    };
  }, [agentIds]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const denialCount = entries.filter((e) => e.kind === "denial").length;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Live Request Stream</span>
          {denialCount > 0 && (
            <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
              {denialCount} denied
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected.size > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-green-500">
              <Radio className="h-3 w-3 animate-pulse" />
              {connected.size} connected
            </div>
          )}
          {entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setEntries([])}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="max-h-72">
        <div className="px-4 py-2">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">
              {connected.size > 0
                ? "Listening for sandbox events…"
                : "Connecting to sandbox event streams…"}
            </p>
          ) : (
            <div className="space-y-0.5 font-mono text-[11px]">
              {entries.map((entry) => {
                const Icon =
                  entry.kind === "denial" ? ShieldAlert :
                  entry.kind === "policy_update" ? ShieldCheck :
                  Radio;

                const timeStr = entry.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });

                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-start gap-1.5 px-1.5 py-1 rounded",
                      entry.severity === "error" && "bg-destructive/5",
                      entry.severity === "success" && "bg-green-500/5",
                      entry.severity === "info" && "bg-muted/30"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3 w-3 mt-0.5 shrink-0",
                        entry.severity === "error" && "text-destructive",
                        entry.severity === "success" && "text-green-500",
                        entry.severity === "info" && "text-muted-foreground"
                      )}
                    />
                    <span className="text-muted-foreground shrink-0">
                      {timeStr}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      [{entry.agentId}]
                    </span>
                    <span
                      className={cn(
                        "truncate",
                        entry.severity === "error" && "text-destructive",
                        entry.severity === "success" &&
                          "text-green-600 dark:text-green-400",
                        entry.severity === "info" && "text-foreground"
                      )}
                      title={entry.label}
                    >
                      {entry.label}
                    </span>
                    {entry.detail && (
                      <span className="text-muted-foreground shrink-0">
                        {entry.detail}
                      </span>
                    )}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function SandboxPolicyTab() {
  const [agents, setAgents] = useState<SandboxAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [policyStates, setPolicyStates] = useState<
    Record<string, AgentPolicyState>
  >({});

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dynamic-agents?limit=100");
      if (!res.ok) return;
      const data = await res.json();
      const allAgents = data.data?.items || data.items || [];
      const items: SandboxAgent[] = allAgents.filter(
        (a: SandboxAgent) => a.sandbox?.enabled
      );
      setAgents(items);

      const newStates: Record<string, AgentPolicyState> = {};
      for (const a of items) {
        newStates[a._id] = policyStates[a._id] || {
          loading: false,
          policy: null,
          policyYaml: "",
          editing: false,
          editYaml: "",
          saving: false,
          error: null,
          statusText: null,
          sandboxStatus: null,
          expanded: false,
        };
      }
      setPolicyStates((prev) => ({ ...prev, ...newStates }));
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const fetchPolicy = useCallback(async (agentId: string) => {
    setPolicyStates((prev) => ({
      ...prev,
      [agentId]: { ...prev[agentId], loading: true, error: null },
    }));

    try {
      const [policyRes, statusRes] = await Promise.all([
        fetch(`/api/dynamic-agents/sandbox/policy/${agentId}`),
        fetch(`/api/dynamic-agents/sandbox/status/${agentId}`),
      ]);

      let policy: PolicyData | null = null;
      let policyYaml = "";
      let policyError: string | null = null;
      if (policyRes.ok) {
        const pd = await policyRes.json();
        policy = pd.policy || null;
        policyYaml = pd.policy_yaml || "";
      } else {
        try {
          const pd = await policyRes.json();
          policyError = pd.detail || `HTTP ${policyRes.status}`;
        } catch {
          policyError = `HTTP ${policyRes.status}`;
        }
      }

      let sandboxStatus = null;
      if (statusRes.ok) {
        const sd = await statusRes.json();
        sandboxStatus = {
          phase: sd.phase,
          connected: sd.connected,
          policy_loaded: sd.policy_loaded,
          policy_status: sd.policy_status,
          policy_error: sd.policy_error,
          sandbox_error: sd.sandbox_error,
        };
      }

      setPolicyStates((prev) => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          loading: false,
          policy,
          policyYaml,
          sandboxStatus,
          error: policyError,
        },
      }));
    } catch {
      setPolicyStates((prev) => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          loading: false,
          error: "Failed to load policy",
        },
      }));
    }
  }, []);

  const handleExpand = useCallback(
    (agentId: string) => {
      setPolicyStates((prev) => {
        const cur = prev[agentId];
        const next = { ...cur, expanded: !cur.expanded };
        return { ...prev, [agentId]: next };
      });
      if (!policyStates[agentId]?.policy && !policyStates[agentId]?.loading) {
        fetchPolicy(agentId);
      }
    },
    [policyStates, fetchPolicy]
  );

  const handleSave = useCallback(
    async (agentId: string) => {
      const st = policyStates[agentId];
      if (!st) return;

      setPolicyStates((prev) => ({
        ...prev,
        [agentId]: { ...prev[agentId], saving: true, error: null },
      }));

      try {
        const res = await fetch(
          `/api/dynamic-agents/sandbox/policy/${agentId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ policy_yaml: st.editYaml }),
          }
        );
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to update");

        setPolicyStates((prev) => ({
          ...prev,
          [agentId]: {
            ...prev[agentId],
            saving: false,
            editing: false,
            statusText: "Policy updated (hot reload)",
          },
        }));
        setTimeout(() => {
          setPolicyStates((prev) => ({
            ...prev,
            [agentId]: { ...prev[agentId], statusText: null },
          }));
        }, 3000);
        await fetchPolicy(agentId);
      } catch (err: unknown) {
        setPolicyStates((prev) => ({
          ...prev,
          [agentId]: {
            ...prev[agentId],
            saving: false,
            error: err instanceof Error ? err.message : "Failed to save",
          },
        }));
      }
    },
    [policyStates, fetchPolicy]
  );

  const handleRemoveRule = useCallback(
    async (agentId: string, ruleId: string) => {
      try {
        const res = await fetch(
          `/api/dynamic-agents/sandbox/policy/${agentId}/rule/${ruleId}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to remove");

        setPolicyStates((prev) => ({
          ...prev,
          [agentId]: { ...prev[agentId], statusText: "Rule removed" },
        }));
        setTimeout(() => {
          setPolicyStates((prev) => ({
            ...prev,
            [agentId]: { ...prev[agentId], statusText: null },
          }));
        }, 3000);
        await fetchPolicy(agentId);
      } catch (err: unknown) {
        setPolicyStates((prev) => ({
          ...prev,
          [agentId]: {
            ...prev[agentId],
            error:
              err instanceof Error ? err.message : "Failed to remove rule",
          },
        }));
      }
    },
    [fetchPolicy]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
        Loading sandbox agents…
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-center py-12">
        <Shield className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
        <h3 className="text-lg font-medium text-foreground mb-1">
          No sandbox agents
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Enable the OpenShell sandbox when creating an agent to manage its
          network and filesystem policies here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {agents.length} agent{agents.length !== 1 ? "s" : ""} with sandbox
          enabled
        </p>
        <Button variant="ghost" size="sm" onClick={fetchAgents} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {agents.map((agent) => {
        const st = policyStates[agent._id] || {
          loading: false,
          policy: null,
          policyYaml: "",
          editing: false,
          editYaml: "",
          saving: false,
          error: null,
          statusText: null,
          sandboxStatus: null,
          expanded: false,
        };

        return (
          <AgentPolicySection
            key={agent._id}
            agent={agent}
            state={st}
            onRefresh={() => fetchPolicy(agent._id)}
            onEdit={() =>
              setPolicyStates((prev) => ({
                ...prev,
                [agent._id]: {
                  ...prev[agent._id],
                  editing: true,
                  editYaml: prev[agent._id]?.policyYaml || "",
                },
              }))
            }
            onSave={() => handleSave(agent._id)}
            onCancelEdit={() =>
              setPolicyStates((prev) => ({
                ...prev,
                [agent._id]: { ...prev[agent._id], editing: false },
              }))
            }
            onEditYamlChange={(yaml) =>
              setPolicyStates((prev) => ({
                ...prev,
                [agent._id]: { ...prev[agent._id], editYaml: yaml },
              }))
            }
            onRemoveRule={(ruleId) => handleRemoveRule(agent._id, ruleId)}
            onToggleExpand={() => handleExpand(agent._id)}
          />
        );
      })}

      <EventStreamPanel agentIds={agents.map((a) => a._id)} />
    </div>
  );
}
