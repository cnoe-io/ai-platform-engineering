"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Save,
  Pencil,
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Shield,
  RefreshCw,
  HelpCircle,
  Server,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { evaluate as evalCel } from "@/lib/rbac/cel-evaluator";
import type { AgMcpPolicy, AgMcpBackend } from "@/lib/rbac/types";

interface AgMcpPoliciesEditorProps {
  isAdmin: boolean;
}

const AG_MOCK_CONTEXT = {
  jwt: {
    sub: "test@example.com",
    realm_access: { roles: ["chat_user", "admin"] },
    org: "default",
  },
  mcp: {
    tool: { name: "search" },
  },
  request: {
    headers: { "x-forwarded-for": "10.0.0.1" },
  },
};

interface ValidationResult {
  valid: boolean;
  result?: boolean;
  error?: string;
}

function validateCelExpression(expression: string): ValidationResult {
  if (!expression.trim()) {
    return { valid: false, error: "Expression cannot be empty" };
  }
  try {
    const result = evalCel(expression.trim(), AG_MOCK_CONTEXT);
    return { valid: true, result: Boolean(result) };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type SyncStatus = "idle" | "pending" | "synced" | "failed";

interface SyncState {
  status: SyncStatus;
  lastSync?: string;
  error?: string;
  policyGeneration?: number;
  bridgeGeneration?: number;
}

export function AgMcpPoliciesEditor({ isAdmin }: AgMcpPoliciesEditorProps) {
  const [policies, setPolicies] = useState<Record<string, AgMcpPolicy[]>>({});
  const [backends, setBackends] = useState<AgMcpBackend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    backend_id: "",
    tool_pattern: "",
    expression: "",
    description: "",
    enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [syncState, setSyncState] = useState<SyncState>({ status: "idle" });
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);

  const [showAddPolicy, setShowAddPolicy] = useState(false);
  const [showAddBackend, setShowAddBackend] = useState(false);
  const [newBackend, setNewBackend] = useState({ id: "", upstream_url: "", description: "" });
  const [showContextRef, setShowContextRef] = useState(false);
  const [expandedBackends, setExpandedBackends] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rbac/ag-policies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPolicies(data.policies ?? {});
      setBackends(data.backends ?? []);
      const allBackendIds = new Set([
        ...Object.keys(data.policies ?? {}),
        ...(data.backends ?? []).map((b: AgMcpBackend) => b.id),
      ]);
      setExpandedBackends(allBackendIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pollSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/rbac/ag-sync-status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.synced) {
        setSyncState({
          status: "synced",
          lastSync: data.last_sync,
          policyGeneration: data.policy_generation,
          bridgeGeneration: data.bridge_generation,
        });
        if (pollRef.current) clearTimeout(pollRef.current);
        setTimeout(() => setSyncState((prev) => (prev.status === "synced" ? { status: "idle" } : prev)), 10000);
        return;
      }
      if (data.error) {
        setSyncState({
          status: "failed",
          error: data.error,
          policyGeneration: data.policy_generation,
          bridgeGeneration: data.bridge_generation,
        });
        if (pollRef.current) clearTimeout(pollRef.current);
        return;
      }
      pollCountRef.current++;
      if (pollCountRef.current < 5) {
        pollRef.current = setTimeout(() => pollSyncStatus(), 2000);
      }
    } catch {
      // ignore
    }
  }, []);

  const startEdit = (backendId: string, policy: AgMcpPolicy) => {
    setEditingKey(`${backendId}::${policy.tool_pattern}`);
    setEditForm({
      backend_id: backendId,
      tool_pattern: policy.tool_pattern,
      expression: policy.expression,
      description: policy.description ?? "",
      enabled: policy.enabled,
    });
    setValidation(validateCelExpression(policy.expression));
    setMessage(null);
  };

  const startAddPolicy = (backendId?: string) => {
    setShowAddPolicy(true);
    setEditingKey(null);
    setEditForm({
      backend_id: backendId ?? backends[0]?.id ?? "",
      tool_pattern: "",
      expression: "",
      description: "",
      enabled: true,
    });
    setValidation(null);
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setShowAddPolicy(false);
    setEditForm({ backend_id: "", tool_pattern: "", expression: "", description: "", enabled: true });
    setValidation(null);
  };

  const onExpressionChange = (expr: string) => {
    setEditForm((prev) => ({ ...prev, expression: expr }));
    if (validationTimer.current) clearTimeout(validationTimer.current);
    validationTimer.current = setTimeout(() => {
      setValidation(validateCelExpression(expr));
    }, 300);
  };

  const savePolicy = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/rbac/ag-policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setMessage({ type: "success", text: `Saved policy for ${editForm.backend_id}/${editForm.tool_pattern}` });
      cancelEdit();
      await fetchData();

      setSyncState({ status: "pending" });
      pollCountRef.current = 0;
      pollRef.current = setTimeout(() => pollSyncStatus(), 2000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const deletePolicy = async (backendId: string, toolPattern: string) => {
    if (!confirm(`Delete policy ${backendId}/${toolPattern}?`)) return;
    try {
      const res = await fetch("/api/rbac/ag-policies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend_id: backendId, tool_pattern: toolPattern }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage({ type: "success", text: `Deleted policy ${backendId}/${toolPattern}` });
      await fetchData();
      setSyncState({ status: "pending" });
      pollCountRef.current = 0;
      pollRef.current = setTimeout(() => pollSyncStatus(), 2000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Delete failed" });
    }
  };

  const saveBackend = async () => {
    if (!newBackend.id || !newBackend.upstream_url) return;
    try {
      const res = await fetch("/api/rbac/ag-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsert_backend", ...newBackend, enabled: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage({ type: "success", text: `Backend "${newBackend.id}" saved` });
      setShowAddBackend(false);
      setNewBackend({ id: "", upstream_url: "", description: "" });
      await fetchData();
      setSyncState({ status: "pending" });
      pollCountRef.current = 0;
      pollRef.current = setTimeout(() => pollSyncStatus(), 2000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed" });
    }
  };

  const deleteBackend = async (id: string) => {
    if (!confirm(`Delete backend "${id}" and all its policies?`)) return;
    try {
      const res = await fetch("/api/rbac/ag-policies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "backend", id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage({ type: "success", text: `Backend "${id}" deleted` });
      await fetchData();
      setSyncState({ status: "pending" });
      pollCountRef.current = 0;
      pollRef.current = setTimeout(() => pollSyncStatus(), 2000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Delete failed" });
    }
  };

  const toggleBackend = (id: string) => {
    setExpandedBackends((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const allBackendIds = Array.from(
    new Set([...Object.keys(policies), ...backends.map((b) => b.id)])
  ).sort();

  return (
    <div className="space-y-4">
      {/* Sync Status Indicator */}
      {syncState.status !== "idle" && (
        <div
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${
            syncState.status === "pending"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
              : syncState.status === "synced"
                ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800"
                : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
          }`}
        >
          {syncState.status === "pending" && (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Syncing to Agent Gateway...
            </>
          )}
          {syncState.status === "synced" && (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Live &mdash; synced{syncState.lastSync ? ` ${new Date(syncState.lastSync).toLocaleTimeString()}` : ""}
              <Badge variant="outline" className="ml-auto text-[10px]">
                gen {syncState.policyGeneration}
              </Badge>
            </>
          )}
          {syncState.status === "failed" && (
            <>
              <AlertCircle className="h-4 w-4" />
              Sync failed: {syncState.error}
            </>
          )}
        </div>
      )}

      {/* Message Banner */}
      {message && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
            message.type === "success"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          {message.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* AG Context Reference Panel */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5" />
                Agent Gateway MCP Policies
              </CardTitle>
              <CardDescription>
                CEL authorization rules enforced by Agent Gateway for each MCP backend.
                Policies are synced to AG via the config bridge (hot-reload, zero downtime).
                {!isAdmin && " Read-only access."}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowContextRef(!showContextRef)}
                className="gap-1.5"
              >
                <HelpCircle className="h-4 w-4" />
                {showContextRef ? "Hide" : "CEL Reference"}
              </Button>
              {isAdmin && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setShowAddBackend(true)} className="gap-1.5">
                    <Server className="h-4 w-4" />
                    Add Backend
                  </Button>
                  <Button size="sm" onClick={() => startAddPolicy()} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add Policy
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Context Reference (collapsible) */}
        {showContextRef && (
          <div className="mx-6 mb-4 p-4 rounded-lg bg-muted/50 border text-sm space-y-3">
            <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">AG CEL Context Variables</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="font-medium text-xs mb-1">JWT Claims</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  <li><code className="bg-muted px-1 rounded">jwt.sub</code> &mdash; Subject (user email)</li>
                  <li><code className="bg-muted px-1 rounded">jwt.realm_access.roles</code> &mdash; Keycloak realm roles (list)</li>
                  <li><code className="bg-muted px-1 rounded">jwt.org</code> &mdash; Organization claim</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-xs mb-1">MCP Tool</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  <li><code className="bg-muted px-1 rounded">mcp.tool.name</code> &mdash; Tool being invoked</li>
                  <li><code className="bg-muted px-1 rounded">has(mcp.tool)</code> &mdash; Check tool exists</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-xs mb-1">Request</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  <li><code className="bg-muted px-1 rounded">request.headers.*</code> &mdash; HTTP headers</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-xs mb-1">Examples</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground font-mono">
                  <li>&quot;admin&quot; in jwt.realm_access.roles</li>
                  <li>has(mcp.tool) && mcp.tool.name.startsWith(&quot;search&quot;)</li>
                  <li>&quot;chat_user&quot; in jwt.realm_access.roles && has(mcp.tool)</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        <CardContent className="space-y-4">
          {/* Add Backend Form */}
          {showAddBackend && isAdmin && (
            <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
              <h4 className="font-medium text-sm">Add MCP Backend</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  placeholder="Backend ID (e.g. aws)"
                  value={newBackend.id}
                  onChange={(e) => setNewBackend((p) => ({ ...p, id: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="Upstream URL (e.g. http://aws-mcp:8080/mcp)"
                  value={newBackend.upstream_url}
                  onChange={(e) => setNewBackend((p) => ({ ...p, upstream_url: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="Description"
                  value={newBackend.description}
                  onChange={(e) => setNewBackend((p) => ({ ...p, description: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => { setShowAddBackend(false); setNewBackend({ id: "", upstream_url: "", description: "" }); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveBackend} disabled={!newBackend.id || !newBackend.upstream_url}>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Save Backend
                </Button>
              </div>
            </div>
          )}

          {/* Add Policy Form */}
          {showAddPolicy && isAdmin && (
            <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
              <h4 className="font-medium text-sm">Add MCP Policy</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Backend</label>
                  <select
                    value={editForm.backend_id}
                    onChange={(e) => setEditForm((p) => ({ ...p, backend_id: e.target.value }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select backend...</option>
                    {backends.map((b) => (
                      <option key={b.id} value={b.id}>{b.id} — {b.description}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Tool Pattern</label>
                  <Input
                    placeholder="e.g. rag_query, admin_, team_"
                    value={editForm.tool_pattern}
                    onChange={(e) => setEditForm((p) => ({ ...p, tool_pattern: e.target.value }))}
                    className="text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">CEL Expression</label>
                <Input
                  placeholder='e.g. "admin" in jwt.realm_access.roles'
                  value={editForm.expression}
                  onChange={(e) => onExpressionChange(e.target.value)}
                  className="font-mono text-xs"
                />
                {validation && (
                  <div className={`mt-1 flex items-center gap-1.5 text-xs ${validation.valid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {validation.valid ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                    {validation.valid
                      ? `Valid — evaluates to ${validation.result ? "allow" : "deny"} (mock context)`
                      : validation.error}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
                <Input
                  placeholder="Human-readable description"
                  value={editForm.description}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={savePolicy}
                  disabled={saving || !editForm.backend_id || !editForm.tool_pattern || !editForm.expression || (validation !== null && !validation.valid)}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save Policy
                </Button>
              </div>
            </div>
          )}

          {/* Policies grouped by backend */}
          {allBackendIds.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No backends or policies configured. Add a backend to get started.
            </p>
          )}

          {allBackendIds.map((backendId) => {
            const backend = backends.find((b) => b.id === backendId);
            const backendPolicies = policies[backendId] ?? [];
            const isExpanded = expandedBackends.has(backendId);

            return (
              <div key={backendId} className="border rounded-lg overflow-hidden">
                {/* Backend header */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => toggleBackend(backendId)}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-semibold text-sm">{backendId}</span>
                  {backend && (
                    <span className="text-xs text-muted-foreground truncate">
                      {backend.upstream_url}
                    </span>
                  )}
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {backendPolicies.length} {backendPolicies.length === 1 ? "rule" : "rules"}
                  </Badge>
                  {backend && !backend.enabled && (
                    <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                      disabled
                    </Badge>
                  )}
                  {isAdmin && (
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => startAddPolicy(backendId)}
                        title="Add policy"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                        onClick={() => deleteBackend(backendId)}
                        title="Delete backend"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </button>

                {/* Policy rows */}
                {isExpanded && (
                  <div className="divide-y">
                    {backendPolicies.length === 0 && (
                      <p className="px-4 py-3 text-xs text-muted-foreground italic">
                        No policies for this backend.
                      </p>
                    )}
                    {backendPolicies.map((policy) => {
                      const key = `${backendId}::${policy.tool_pattern}`;
                      const isEditing = editingKey === key;

                      return (
                        <div key={key} className="px-4 py-2.5 hover:bg-muted/20 transition-colors">
                          {isEditing ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] shrink-0">{editForm.tool_pattern}</Badge>
                                <Input
                                  value={editForm.expression}
                                  onChange={(e) => onExpressionChange(e.target.value)}
                                  className="font-mono text-xs h-8 flex-1"
                                  placeholder="CEL expression..."
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") cancelEdit();
                                  }}
                                />
                                <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving} className="h-7 w-7 p-0">
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={savePolicy}
                                  disabled={saving || (validation !== null && !validation.valid)}
                                  className="h-7 w-7 p-0"
                                >
                                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                </Button>
                              </div>
                              {validation && (
                                <div className={`flex items-center gap-1.5 text-xs ${validation.valid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                  {validation.valid ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                                  {validation.valid
                                    ? `Valid — evaluates to ${validation.result ? "allow" : "deny"} (mock: roles=[chat_user, admin])`
                                    : validation.error}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <Badge variant={policy.enabled ? "default" : "secondary"} className="text-[10px] shrink-0">
                                  {policy.tool_pattern}
                                </Badge>
                                <code className="text-xs font-mono text-muted-foreground truncate">
                                  {policy.expression}
                                </code>
                              </div>
                              {policy.description && (
                                <span className="text-[10px] text-muted-foreground hidden lg:block max-w-48 truncate">
                                  {policy.description}
                                </span>
                              )}
                              {!policy.enabled && (
                                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                                  off
                                </Badge>
                              )}
                              {isAdmin && (
                                <div className="flex gap-1 shrink-0">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => startEdit(backendId, policy)}
                                    className="h-7 w-7 p-0"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                    onClick={() => deletePolicy(backendId, policy.tool_pattern)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
