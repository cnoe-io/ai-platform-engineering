"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Link2, Unlink, Filter } from "lucide-react";

export type SlackLinkFilter = "all" | "linked" | "pending" | "unlinked";

export interface SlackUserRow {
  keycloak_user_id: string;
  username?: string;
  email?: string;
  display_name?: string;
  slack_user_id: string;
  link_status: "linked" | "pending" | "unlinked";
  enabled?: boolean;
  roles: string[];
  teams: string[];
  last_interaction: string | null;
  obo_success_count: number;
  obo_fail_count: number;
  active_channels: string[];
}

interface SlackUsersTabProps {
  isAdmin: boolean;
}

export function SlackUsersTab({ isAdmin }: SlackUsersTabProps) {
  const [rows, setRows] = useState<SlackUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);
  const [filter, setFilter] = useState<SlackLinkFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (filter !== "all") params.set("status", filter);
      const res = await fetch(`/api/admin/slack/users?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load");
      const data = json.data as {
        items: SlackUserRow[];
        total: number;
        page: number;
        page_size: number;
      };
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusBadge = (s: SlackUserRow["link_status"]) => {
    if (s === "linked")
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
          Linked
        </span>
      );
    if (s === "pending")
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-800 dark:text-amber-400 border border-amber-500/25">
          Pending
        </span>
      );
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/25">
        Unlinked
      </span>
    );
  };

  const relink = async (keycloakUserId: string) => {
    if (!keycloakUserId || !isAdmin) return;
    setBusyId(keycloakUserId);
    try {
      const res = await fetch(`/api/admin/slack/users/${encodeURIComponent(keycloakUserId)}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed");
      const url = json.data?.relink_url as string | undefined;
      if (url) {
        await navigator.clipboard.writeText(url);
        alert("Re-link URL copied to clipboard. Send it to the Slack user.");
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Re-link failed");
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (keycloakUserId: string) => {
    if (!keycloakUserId || !isAdmin) return;
    if (!confirm("Remove Slack link for this user?")) return;
    setBusyId(keycloakUserId);
    try {
      const res = await fetch(`/api/admin/slack/users/${encodeURIComponent(keycloakUserId)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Slack users
          </CardTitle>
          <CardDescription>
            Keycloak users with Slack identity links and operational metrics
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["all", "linked", "pending", "unlinked"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
                className={`px-2.5 py-1.5 text-xs font-medium capitalize flex items-center gap-1 ${
                  filter === f ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                }`}
              >
                {f === "all" && <Filter className="h-3 w-3" />}
                {f}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}
        {loading && rows.length === 0 ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 rounded-md bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th className="p-3 whitespace-nowrap">Display name</th>
                  <th className="p-3 whitespace-nowrap">Slack ID</th>
                  <th className="p-3 whitespace-nowrap">Status</th>
                  <th className="p-3 whitespace-nowrap">Keycloak user</th>
                  <th className="p-3 whitespace-nowrap">Roles</th>
                  <th className="p-3 whitespace-nowrap">Teams</th>
                  <th className="p-3 whitespace-nowrap">Linked</th>
                  <th className="p-3 whitespace-nowrap">Last active</th>
                  <th className="p-3 whitespace-nowrap">OBO stats</th>
                  <th className="p-3 whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.slack_user_id}-${r.keycloak_user_id}`} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="p-3 max-w-[140px] truncate">{r.display_name || r.email || "—"}</td>
                    <td className="p-3 font-mono text-xs">{r.slack_user_id}</td>
                    <td className="p-3">{statusBadge(r.link_status)}</td>
                    <td className="p-3 max-w-[100px] truncate text-xs">{r.username || "—"}</td>
                    <td className="p-3 max-w-[160px]">
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {r.roles.length ? r.roles.join(", ") : "—"}
                      </span>
                    </td>
                    <td className="p-3 max-w-[120px]">
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {r.teams.length ? r.teams.join(", ") : "—"}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {r.last_interaction ? new Date(r.last_interaction).toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-xs font-mono whitespace-nowrap">
                      {r.obo_success_count} / {r.obo_fail_count}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {isAdmin && r.keycloak_user_id ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={busyId === r.keycloak_user_id}
                            onClick={() => void relink(r.keycloak_user_id)}
                          >
                            Re-link
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive"
                            disabled={busyId === r.keycloak_user_id}
                            onClick={() => void revoke(r.keycloak_user_id)}
                          >
                            <Unlink className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">No rows for this filter.</p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
