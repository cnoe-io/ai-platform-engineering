"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  ShieldAlert,
  RefreshCw,
  Pencil,
  X,
  Check,
  Network,
  HardDrive,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SandboxDenialData } from "./sse-types";

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

interface SandboxPolicyPanelProps {
  agentId: string;
  denials?: SandboxDenialData[];
  onAllowRule?: (host: string, port: number, temporary: boolean) => void;
  /** Incremented when a sandbox_policy_update SSE event arrives to trigger re-fetch */
  refreshTrigger?: number;
}

export function SandboxPolicyPanel({
  agentId,
  denials = [],
  onAllowRule,
  refreshTrigger = 0,
}: SandboxPolicyPanelProps) {
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [policyYaml, setPolicyYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editYaml, setEditYaml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const fetchPolicy = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/dynamic-agents/sandbox/policy/${agentId}`);
      if (!res.ok) {
        if (res.status === 400) {
          setPolicy(null);
          return;
        }
        throw new Error("Failed to fetch policy");
      }
      const data = await res.json();
      setPolicy(data.policy || null);
      setPolicyYaml(data.policy_yaml || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load policy");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  // Re-fetch when external policy updates arrive via SSE
  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchPolicy();
    }
  }, [refreshTrigger, fetchPolicy]);

  const handleSavePolicy = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/dynamic-agents/sandbox/policy/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_yaml: editYaml }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update policy");
      }
      setEditing(false);
      setStatusText("Policy updated (hot reload)");
      setTimeout(() => setStatusText(null), 3000);
      await fetchPolicy();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveRule = async (ruleId: string) => {
    try {
      const res = await fetch(
        `/api/dynamic-agents/sandbox/policy/${agentId}/rule/${ruleId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to remove rule");
      }
      setStatusText("Rule removed");
      setTimeout(() => setStatusText(null), 3000);
      await fetchPolicy();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove rule");
    }
  };

  const networkRules = policy?.network_policies
    ? Object.entries(policy.network_policies)
    : [];

  const readWritePaths = policy?.filesystem_policy?.read_write || [];
  const readOnlyPaths = policy?.filesystem_policy?.read_only || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Loading policy...
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p>Sandbox not active</p>
        <p className="text-xs mt-1">Start a chat to initialize the sandbox.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-500" />
          <h4 className="text-xs font-medium uppercase tracking-wider">
            Sandbox Policy
          </h4>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={fetchPolicy}
            title="Refresh policy"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              setEditYaml(policyYaml);
              setEditing(true);
            }}
            title="Edit policy YAML"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Status */}
      {statusText && (
        <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <Check className="h-3 w-3" />
          {statusText}
        </div>
      )}

      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}

      {/* Edit mode */}
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editYaml}
            onChange={(e) => setEditYaml(e.target.value)}
            className="w-full h-64 font-mono text-xs p-2 rounded border bg-muted/50 resize-y"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSavePolicy}
              disabled={saving}
              className="text-xs"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : null}
              Save & Hot Reload
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              className="text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Network Rules */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Network className="h-3 w-3" />
              <span>Network Rules ({networkRules.length})</span>
            </div>
            {networkRules.length === 0 ? (
              <p className="text-xs text-muted-foreground italic pl-5">
                No network access allowed
              </p>
            ) : (
              <ScrollArea className="max-h-40">
                <div className="space-y-1">
                  {networkRules.map(([ruleId, rule]) => (
                    <div
                      key={ruleId}
                      className={cn(
                        "flex items-center justify-between px-2 py-1 rounded text-xs border",
                        rule._temporary
                          ? "border-amber-500/30 bg-amber-500/5"
                          : "border-border/50 bg-muted/30"
                      )}
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{rule.name || ruleId}</span>
                        {rule.endpoints?.[0] && (
                          <span className="text-muted-foreground ml-1">
                            {rule.endpoints[0].host}:{rule.endpoints[0].port || 443}
                          </span>
                        )}
                        {rule._temporary && (
                          <span className="text-amber-600 dark:text-amber-400 ml-1">(temp)</span>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveRule(ruleId)}
                        className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                        title="Remove rule"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Filesystem */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              <span>Filesystem</span>
            </div>
            <div className="text-xs space-y-0.5 pl-5">
              {readWritePaths.length > 0 && (
                <p>
                  <span className="text-green-600 dark:text-green-400">RW:</span>{" "}
                  {readWritePaths.join(", ")}
                </p>
              )}
              {readOnlyPaths.length > 0 && (
                <p>
                  <span className="text-muted-foreground">RO:</span>{" "}
                  {readOnlyPaths.slice(0, 3).join(", ")}
                  {readOnlyPaths.length > 3 && ` +${readOnlyPaths.length - 3} more`}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Recent Denials */}
      {denials.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <ShieldAlert className="h-3 w-3" />
            <span>Recent Denials ({denials.length})</span>
          </div>
          <ScrollArea className="max-h-32">
            <div className="space-y-1">
              {denials.map((denial) => (
                <div
                  key={denial.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded text-xs border border-destructive/30 bg-destructive/5"
                >
                  <div className="min-w-0">
                    <span className="font-mono">
                      {denial.host || "unknown"}:{denial.port || "?"}
                    </span>
                    <span className="text-muted-foreground ml-1">
                      ({denial.stage || denial.reason || "denied"})
                    </span>
                  </div>
                  {onAllowRule && denial.host && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] ml-2 shrink-0"
                      onClick={() =>
                        onAllowRule(
                          denial.host!,
                          denial.port || 443,
                          false
                        )
                      }
                    >
                      Allow
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
