"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { KbPermission } from "@/lib/rbac/types";

interface KbAssignment {
  team_id: string;
  kb_ids: string[];
  kb_permissions: Record<string, KbPermission>;
  allowed_datasource_ids: string[];
  updated_at: string | null;
  updated_by: string | null;
}

interface DatasourceInfo {
  datasource_id: string;
  name?: string;
  ingestor_id?: string;
}

interface TeamKbAssignmentPanelProps {
  teamId: string;
  teamName: string;
  isAdmin: boolean;
}

const PERMISSION_LABELS: Record<KbPermission, string> = {
  read: "Read",
  ingest: "Ingest",
  admin: "Admin",
};

const PERMISSION_COLORS: Record<KbPermission, string> = {
  read: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ingest:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  admin:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

export function TeamKbAssignmentPanel({
  teamId,
  teamName,
  isAdmin,
}: TeamKbAssignmentPanelProps) {
  const [assignment, setAssignment] = useState<KbAssignment | null>(null);
  const [availableKbs, setAvailableKbs] = useState<DatasourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newKbId, setNewKbId] = useState<string>("");
  const [newKbPermission, setNewKbPermission] = useState<KbPermission>("read");

  const loadAssignments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/teams/${teamId}/kb-assignments`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || `HTTP ${res.status}`
        );
      }
      const data = (await res.json()) as { data: KbAssignment };
      setAssignment(data.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load KB assignments"
      );
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const loadAvailableKbs = useCallback(async () => {
    try {
      const res = await fetch("/api/rag/v1/datasources");
      if (res.ok) {
        const data = (await res.json()) as {
          datasources?: DatasourceInfo[];
        };
        setAvailableKbs(data.datasources ?? []);
      }
    } catch {
      // Non-critical — KB list may be unavailable
    }
  }, []);

  useEffect(() => {
    loadAssignments();
    loadAvailableKbs();
  }, [loadAssignments, loadAvailableKbs]);

  const handleAddKb = async () => {
    if (!newKbId || !assignment) return;

    const updatedKbIds = [...assignment.kb_ids, newKbId];
    const updatedPermissions = {
      ...assignment.kb_permissions,
      [newKbId]: newKbPermission,
    };

    await saveAssignments(updatedKbIds, updatedPermissions);
    setNewKbId("");
    setNewKbPermission("read");
  };

  const handleRemoveKb = async (datasourceId: string) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(
        `/api/admin/teams/${teamId}/kb-assignments?datasource_id=${encodeURIComponent(datasourceId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || `HTTP ${res.status}`
        );
      }
      setSuccess(`KB "${datasourceId}" removed`);
      setTimeout(() => setSuccess(null), 3000);
      await loadAssignments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove KB assignment"
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionChange = async (
    datasourceId: string,
    permission: KbPermission
  ) => {
    if (!assignment) return;
    const updatedPermissions = {
      ...assignment.kb_permissions,
      [datasourceId]: permission,
    };
    await saveAssignments(assignment.kb_ids, updatedPermissions);
  };

  const saveAssignments = async (
    kbIds: string[],
    kbPermissions: Record<string, KbPermission>
  ) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/admin/teams/${teamId}/kb-assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kb_ids: kbIds, kb_permissions: kbPermissions }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || `HTTP ${res.status}`
        );
      }
      setSuccess("KB assignments saved");
      setTimeout(() => setSuccess(null), 3000);
      await loadAssignments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save KB assignments"
      );
    } finally {
      setSaving(false);
    }
  };

  const unassignedKbs = availableKbs.filter(
    (kb) => !assignment?.kb_ids.includes(kb.datasource_id)
  );

  const getKbDisplayName = (dsId: string): string => {
    const found = availableKbs.find((kb) => kb.datasource_id === dsId);
    return found?.name || dsId;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-muted-foreground">
            Loading KB assignments...
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">
            Knowledge Base Assignments
          </CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          KBs assigned to <strong>{teamName}</strong>. Team members can access
          these KBs based on the assigned permission level.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-sm">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {assignment && assignment.kb_ids.length > 0 ? (
          <div className="space-y-2">
            {assignment.kb_ids.map((kbId) => (
              <div
                key={kbId}
                className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
              >
                <div className="flex items-center gap-3">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {getKbDisplayName(kbId)}
                  </span>
                  <Badge
                    variant="secondary"
                    className={
                      PERMISSION_COLORS[
                        assignment.kb_permissions[kbId] || "read"
                      ]
                    }
                  >
                    {
                      PERMISSION_LABELS[
                        assignment.kb_permissions[kbId] || "read"
                      ]
                    }
                  </Badge>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <select
                      className="flex h-8 w-24 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={assignment.kb_permissions[kbId] || "read"}
                      onChange={(e) =>
                        handlePermissionChange(kbId, e.target.value as KbPermission)
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
                      className="text-destructive hover:text-destructive h-8 w-8 p-0"
                      onClick={() => handleRemoveKb(kbId)}
                      disabled={saving}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-sm">
            No KBs assigned to this team yet.
          </div>
        )}

        {isAdmin && (
          <div className="flex items-center gap-2 pt-2 border-t">
            <select
              className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={newKbId}
              onChange={(e) => setNewKbId(e.target.value)}
            >
              <option value="">Select a KB to add...</option>
              {unassignedKbs.length === 0 ? (
                <option value="" disabled>
                  No available KBs
                </option>
              ) : (
                unassignedKbs.map((kb) => (
                  <option
                    key={kb.datasource_id}
                    value={kb.datasource_id}
                  >
                    {kb.name || kb.datasource_id}
                  </option>
                ))
              )}
            </select>
            <select
              className="flex h-9 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={newKbPermission}
              onChange={(e) => setNewKbPermission(e.target.value as KbPermission)}
            >
              <option value="read">Read</option>
              <option value="ingest">Ingest</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              size="sm"
              className="h-9 gap-1"
              onClick={handleAddKb}
              disabled={!newKbId || saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>
        )}

        {assignment?.updated_by && (
          <p className="text-xs text-muted-foreground pt-2">
            Last updated by {assignment.updated_by}
            {assignment.updated_at &&
              ` on ${new Date(assignment.updated_at).toLocaleDateString()}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
