"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Users,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { KbPermission } from "@/lib/rbac/types";

interface TeamBasic {
  _id: string;
  name: string;
}

interface TeamKbInfo {
  teamId: string;
  teamName: string;
  permission: KbPermission;
}

interface KbTeamAccessPanelProps {
  datasourceId: string;
  mode: "compact" | "full";
  onUpdate?: () => void;
}

const PERMISSION_LABELS: Record<KbPermission, string> = {
  read: "Read",
  ingest: "Ingest",
  admin: "Admin",
};

const PERMISSION_COLORS: Record<KbPermission, string> = {
  read: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ingest: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const selectClass =
  "flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface KbAssignmentData {
  team_id: string;
  kb_ids: string[];
  kb_permissions: Record<string, KbPermission>;
}

export function KbTeamAccessPanel({
  datasourceId,
  mode,
  onUpdate,
}: KbTeamAccessPanelProps) {
  const [teams, setTeams] = useState<TeamBasic[]>([]);
  const [assignments, setAssignments] = useState<TeamKbInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addTeamId, setAddTeamId] = useState("");
  const [addPermission, setAddPermission] = useState<KbPermission>("read");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const teamsRes = await fetch("/api/admin/teams");
      if (!teamsRes.ok) {
        setLoading(false);
        return;
      }
      const teamsData = (await teamsRes.json()) as {
        data?: { teams?: TeamBasic[] };
      };
      const allTeams: TeamBasic[] = teamsData.data?.teams ?? [];
      setTeams(allTeams);

      const found: TeamKbInfo[] = [];
      await Promise.all(
        allTeams.map(async (team) => {
          try {
            const res = await fetch(
              `/api/admin/teams/${team._id}/kb-assignments`
            );
            if (!res.ok) return;
            const data = (await res.json()) as { data: KbAssignmentData };
            const assignment = data.data;
            if (assignment.kb_ids.includes(datasourceId)) {
              found.push({
                teamId: team._id,
                teamName: team.name,
                permission: assignment.kb_permissions[datasourceId] || "read",
              });
            }
          } catch {
            /* non-critical */
          }
        })
      );
      setAssignments(found);
    } catch {
      setError("Failed to load team data");
    } finally {
      setLoading(false);
    }
  }, [datasourceId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!addTeamId) return;
    try {
      setSaving(true);
      setError(null);

      const res = await fetch(`/api/admin/teams/${addTeamId}/kb-assignments`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const current = (await res.json()) as { data: KbAssignmentData };
      const kbIds = [...(current.data.kb_ids || []), datasourceId];
      const perms = {
        ...(current.data.kb_permissions || {}),
        [datasourceId]: addPermission,
      };

      const putRes = await fetch(
        `/api/admin/teams/${addTeamId}/kb-assignments`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kb_ids: kbIds, kb_permissions: perms }),
        }
      );
      if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: string }).error || `HTTP ${putRes.status}`
        );
      }

      setSuccess("Team added");
      setTimeout(() => setSuccess(null), 2000);
      setAddTeamId("");
      setAddPermission("read");
      await load();
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add team");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (teamId: string) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(
        `/api/admin/teams/${teamId}/kb-assignments?datasource_id=${encodeURIComponent(datasourceId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: string }).error || `HTTP ${res.status}`
        );
      }
      setSuccess("Team removed");
      setTimeout(() => setSuccess(null), 2000);
      await load();
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove team");
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionChange = async (
    teamId: string,
    newPerm: KbPermission
  ) => {
    try {
      setSaving(true);
      setError(null);

      const res = await fetch(`/api/admin/teams/${teamId}/kb-assignments`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const current = (await res.json()) as { data: KbAssignmentData };
      const perms = {
        ...(current.data.kb_permissions || {}),
        [datasourceId]: newPerm,
      };

      const putRes = await fetch(`/api/admin/teams/${teamId}/kb-assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kb_ids: current.data.kb_ids,
          kb_permissions: perms,
        }),
      });
      if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);

      await load();
      onUpdate?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update permission"
      );
    } finally {
      setSaving(false);
    }
  };

  const unassignedTeams = teams.filter(
    (t) => !assignments.some((a) => a.teamId === t._id)
  );

  const content = (
    <div className={mode === "compact" ? "p-3 w-72" : "space-y-3"}>
      {mode === "full" && (
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h5 className="text-sm font-semibold text-foreground">Team Access</h5>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-destructive text-xs">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-xs">
          <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading...
        </div>
      ) : (
        <>
          {assignments.length > 0 ? (
            <div className="space-y-1.5">
              {assignments.map((a) => (
                <div
                  key={a.teamId}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-medium">{a.teamName}</span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1 py-0 h-4 ${PERMISSION_COLORS[a.permission]}`}
                    >
                      {PERMISSION_LABELS[a.permission]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <select
                      className={`${selectClass} w-20`}
                      value={a.permission}
                      onChange={(e) =>
                        handlePermissionChange(
                          a.teamId,
                          e.target.value as KbPermission
                        )
                      }
                      disabled={saving}
                    >
                      <option value="read">Read</option>
                      <option value="ingest">Ingest</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleRemove(a.teamId)}
                      disabled={saving}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-1">
              Not shared with any team.
            </p>
          )}

          {unassignedTeams.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1.5 border-t border-border">
              <select
                className={`${selectClass} flex-1`}
                value={addTeamId}
                onChange={(e) => setAddTeamId(e.target.value)}
              >
                <option value="">Add team...</option>
                {unassignedTeams.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                className={`${selectClass} w-20`}
                value={addPermission}
                onChange={(e) =>
                  setAddPermission(e.target.value as KbPermission)
                }
              >
                <option value="read">Read</option>
                <option value="ingest">Ingest</option>
                <option value="admin">Admin</option>
              </select>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleAdd}
                disabled={!addTeamId || saving}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

  if (mode === "compact") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            title="Manage team access"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <Users className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-auto">
          {content}
        </PopoverContent>
      </Popover>
    );
  }

  return content;
}
