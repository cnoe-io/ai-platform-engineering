"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Save,
  Pencil,
  X,
  Code2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AdminTabKey } from "@/lib/rbac/types";

interface TabPolicy {
  tab_key: AdminTabKey;
  expression: string;
}

interface CelTabPoliciesEditorProps {
  isAdmin: boolean;
}

const TAB_LABELS: Record<string, string> = {
  users: "Users",
  teams: "Teams",
  roles: "Roles",
  slack: "Slack Integration",
  skills: "Skills",
  feedback: "Feedback",
  nps: "NPS",
  stats: "Statistics",
  metrics: "Metrics",
  health: "Health",
  audit_logs: "Audit Logs",
  action_audit: "Action Audit",
  policy: "Policy",
  ag_policies: "AG MCP Policies",
};

export function CelTabPoliciesEditor({ isAdmin }: CelTabPoliciesEditorProps) {
  const [policies, setPolicies] = useState<TabPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rbac/admin-tab-gates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.gates) {
        const entries = Object.entries(data.gates) as [AdminTabKey, boolean][];
        const result: TabPolicy[] = entries.map(([key]) => ({
          tab_key: key,
          expression: "",
        }));
        setPolicies(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRawPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rbac/admin-tab-policies");
      if (!res.ok) {
        // Endpoint may not exist yet; fall back to showing gates only
        await fetchPolicies();
        return;
      }
      const data = await res.json();
      if (data.policies) {
        setPolicies(data.policies);
      }
    } catch {
      await fetchPolicies();
    } finally {
      setLoading(false);
    }
  }, [fetchPolicies]);

  useEffect(() => {
    fetchRawPolicies();
  }, [fetchRawPolicies]);

  const startEdit = (tab: string, currentExpr: string) => {
    setEditingTab(tab);
    setEditValue(currentExpr);
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingTab(null);
    setEditValue("");
  };

  const savePolicy = async (tabKey: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/rbac/admin-tab-gates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab_key: tabKey, expression: editValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setPolicies((prev) =>
        prev.map((p) =>
          p.tab_key === tabKey ? { ...p, expression: editValue.trim() } : p
        )
      );
      setEditingTab(null);
      setMessage({ type: "success", text: `Updated "${TAB_LABELS[tabKey] || tabKey}" policy` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
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

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Code2 className="h-5 w-5" />
            Admin Tab Visibility Policies (CEL)
          </CardTitle>
          <CardDescription>
            CEL (Common Expression Language) expressions that control which admin
            tabs are visible to each user. Context variables:{" "}
            <code className="text-xs bg-muted px-1 rounded">user.roles</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">user.email</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">user.teams</code>.
            {!isAdmin && " Read-only access."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-500/10 text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {message && (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
              message.type === "success"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}

        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium w-40">Tab</th>
                <th className="px-4 py-2.5 font-medium">CEL Expression</th>
                {isAdmin && <th className="px-4 py-2.5 font-medium w-24 text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const isEditing = editingTab === p.tab_key;
                const isOpen = p.expression === "true";
                const isAdminOnly = p.expression.includes("'admin'");
                return (
                  <tr
                    key={p.tab_key}
                    className="border-t hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs">
                          {TAB_LABELS[p.tab_key] || p.tab_key}
                        </span>
                        {isOpen && (
                          <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 bg-green-50 dark:bg-green-950 dark:text-green-400 dark:border-green-800">
                            open
                          </Badge>
                        )}
                        {isAdminOnly && !isOpen && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
                            admin
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="font-mono text-xs h-8"
                          placeholder="CEL expression..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") savePolicy(p.tab_key);
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      ) : (
                        <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                          {p.expression || "—"}
                        </code>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="h-7 w-7 p-0"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => savePolicy(p.tab_key)}
                              disabled={saving}
                              className="h-7 w-7 p-0"
                            >
                              {saving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(p.tab_key, p.expression)}
                            className="h-7 w-7 p-0"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Examples: <code className="bg-muted px-1 rounded">true</code> (visible to all),{" "}
          <code className="bg-muted px-1 rounded">&apos;admin&apos; in user.roles</code> (admin only),{" "}
          <code className="bg-muted px-1 rounded">&apos;admin&apos; in user.roles || &apos;kb_admin&apos; in user.roles</code> (admin or KB admin).
        </p>
      </CardContent>
    </Card>
  );
}
