"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Database,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  ExternalLink,
  Eye,
  Upload,
  ShieldCheck,
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

const PERMISSION_META: Record<
  KbPermission,
  { label: string; help: string; icon: React.ReactNode; tone: string }
> = {
  read: {
    label: "Read",
    help: "Members can search and retrieve documents from this KB.",
    icon: <Eye className="h-3 w-3" />,
    tone: "bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/30",
  },
  ingest: {
    label: "Ingest",
    help: "Members can read AND push new documents/datasources into this KB.",
    icon: <Upload className="h-3 w-3" />,
    tone: "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/30",
  },
  admin: {
    label: "Admin",
    help: "Full control: read, ingest, delete documents, and reconfigure the KB.",
    icon: <ShieldCheck className="h-3 w-3" />,
    tone: "bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/30",
  },
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
  const [kbsApiOk, setKbsApiOk] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Pending bulk-add selection — NOT persisted until user clicks "Add N KBs".
  const [pendingKbIds, setPendingKbIds] = useState<string[]>([]);
  const [pendingPermission, setPendingPermission] =
    useState<KbPermission>("read");

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
        setKbsApiOk(true);
      } else {
        setKbsApiOk(false);
      }
    } catch {
      setKbsApiOk(false);
    }
  }, []);

  useEffect(() => {
    loadAssignments();
    loadAvailableKbs();
  }, [loadAssignments, loadAvailableKbs]);

  // Map between datasource_id (stable, what we persist) and a display label
  // (what we show in the MultiSelect). We use display labels in the picker so
  // operators don't have to read raw IDs, then translate back on submit.
  const idToLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const kb of availableKbs) {
      m.set(kb.datasource_id, kb.name || kb.datasource_id);
    }
    return m;
  }, [availableKbs]);

  const labelToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const kb of availableKbs) {
      const label = kb.name || kb.datasource_id;
      // If two KBs collide on display name, fall back to id for the second one.
      if (m.has(label)) m.set(kb.datasource_id, kb.datasource_id);
      else m.set(label, kb.datasource_id);
    }
    return m;
  }, [availableKbs]);

  const unassignedKbs = useMemo(
    () =>
      availableKbs.filter(
        (kb) => !assignment?.kb_ids.includes(kb.datasource_id)
      ),
    [availableKbs, assignment]
  );

  const handleBulkAdd = async () => {
    if (!assignment || pendingKbIds.length === 0) return;

    const updatedKbIds = [...assignment.kb_ids, ...pendingKbIds];
    const updatedPermissions = { ...assignment.kb_permissions };
    for (const id of pendingKbIds) updatedPermissions[id] = pendingPermission;

    await saveAssignments(
      updatedKbIds,
      updatedPermissions,
      `Added ${pendingKbIds.length} KB${pendingKbIds.length === 1 ? "" : "s"}`
    );
    setPendingKbIds([]);
    setPendingPermission("read");
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
      flashSuccess(`Removed "${getKbDisplayName(datasourceId)}"`);
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
    await saveAssignments(
      assignment.kb_ids,
      updatedPermissions,
      `Updated permission for "${getKbDisplayName(datasourceId)}"`
    );
  };

  const saveAssignments = async (
    kbIds: string[],
    kbPermissions: Record<string, KbPermission>,
    successMsg: string
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
      flashSuccess(successMsg);
      await loadAssignments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save KB assignments"
      );
    } finally {
      setSaving(false);
    }
  };

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const getKbDisplayName = (dsId: string): string =>
    idToLabel.get(dsId) || dsId;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading knowledge bases…</span>
      </div>
    );
  }

  const assignedCount = assignment?.kb_ids.length ?? 0;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        {/* Intro / context — explains what this surface controls. */}
        <p className="text-xs text-muted-foreground">
          Grant <strong>{teamName}</strong> access to specific knowledge bases.
          Permissions stack: <em>Ingest</em> includes <em>Read</em>; <em>Admin</em>{" "}
          includes both.
        </p>

        {/* Banners */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-sm">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}
        {!kbsApiOk && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              Couldn&apos;t reach the RAG datasources API. The picker below will
              be empty until the RAG server is reachable. Already-assigned KBs
              will still display by ID.
            </span>
          </div>
        )}

        {/* Section: Assigned KBs */}
        <section className="rounded-lg border bg-muted/20">
          <header className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium">Assigned</h4>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {assignedCount}
              </Badge>
            </div>
            <PermissionLegend />
          </header>

          {assignedCount === 0 ? (
            <EmptyAssignedState
              hasAvailableKbs={availableKbs.length > 0}
              kbsApiOk={kbsApiOk}
            />
          ) : (
            <ScrollArea
              className="px-2 py-2"
              style={{ maxHeight: "280px" }}
            >
              <ul className="space-y-1">
                {assignment!.kb_ids.map((kbId) => {
                  const perm = assignment!.kb_permissions[kbId] || "read";
                  return (
                    <li
                      key={kbId}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-muted/40 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {getKbDisplayName(kbId)}
                          </p>
                          {getKbDisplayName(kbId) !== kbId && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {kbId}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <PermissionPicker
                          value={perm}
                          disabled={!isAdmin || saving}
                          onChange={(p) => handlePermissionChange(kbId, p)}
                        />
                        {isAdmin && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                onClick={() => handleRemoveKb(kbId)}
                                disabled={saving}
                                aria-label={`Remove ${getKbDisplayName(kbId)}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              Revoke team access to this KB
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </section>

        {/* Section: Bulk add */}
        {isAdmin && (
          <section className="rounded-lg border bg-background">
            <header className="px-4 py-2.5 border-b">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">Add knowledge bases</h4>
              </div>
            </header>
            <div className="p-4 space-y-3">
              {unassignedKbs.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  {availableKbs.length === 0 ? (
                    <span className="inline-flex items-center gap-1">
                      No knowledge bases exist yet.
                      <a
                        href="/rag"
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                      >
                        Create one
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </span>
                  ) : (
                    "All available knowledge bases are already assigned to this team."
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-start">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">
                        Knowledge bases
                      </label>
                      <MultiSelect
                        options={unassignedKbs.map(
                          (kb) => kb.name || kb.datasource_id
                        )}
                        selected={pendingKbIds.map(
                          (id) => idToLabel.get(id) || id
                        )}
                        onChange={(labels) =>
                          setPendingKbIds(
                            labels.map((l) => labelToId.get(l) || l)
                          )
                        }
                        placeholder="Pick one or more…"
                        searchPlaceholder="Search KBs…"
                        emptyLabel="No matching KBs"
                        badgeLabel="KBs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">
                        Permission
                      </label>
                      <PermissionPicker
                        value={pendingPermission}
                        disabled={saving}
                        onChange={setPendingPermission}
                      />
                    </div>
                    <div className="flex md:items-end h-full">
                      <Button
                        size="sm"
                        className="w-full md:w-auto h-9 gap-1 mt-0 md:mt-[22px]"
                        onClick={handleBulkAdd}
                        disabled={pendingKbIds.length === 0 || saving}
                      >
                        {saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        {pendingKbIds.length > 1
                          ? `Add ${pendingKbIds.length}`
                          : "Add"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    All selected KBs will be assigned with the same permission.
                    You can change individual permissions afterward.
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {assignment?.updated_by && (
          <p className="text-[11px] text-muted-foreground">
            Last updated by <span className="font-medium">{assignment.updated_by}</span>
            {assignment.updated_at &&
              ` · ${new Date(assignment.updated_at).toLocaleString()}`}
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}

/* ----------------------------- helpers ----------------------------- */

function PermissionLegend() {
  return (
    <div className="hidden sm:flex items-center gap-2">
      {(Object.keys(PERMISSION_META) as KbPermission[]).map((p) => {
        const meta = PERMISSION_META[p];
        return (
          <Tooltip key={p}>
            <TooltipTrigger asChild>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.tone}`}
              >
                {meta.icon}
                {meta.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{meta.help}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function PermissionPicker({
  value,
  disabled,
  onChange,
}: {
  value: KbPermission;
  disabled?: boolean;
  onChange: (p: KbPermission) => void;
}) {
  const meta = PERMISSION_META[value];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative inline-flex">
          {/* Native select kept for keyboard accessibility & screen readers,
              but visually styled as a chip matching the permission tone. The
              transparent <select> sits on top of the chip. */}
          <span
            className={`pointer-events-none inline-flex items-center gap-1 px-2 h-7 rounded-md border text-xs font-medium ${meta.tone}`}
          >
            {meta.icon}
            {meta.label}
          </span>
          <select
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value as KbPermission)}
            className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
            aria-label="Permission level"
          >
            {(Object.keys(PERMISSION_META) as KbPermission[]).map((p) => (
              <option key={p} value={p}>
                {PERMISSION_META[p].label}
              </option>
            ))}
          </select>
        </div>
      </TooltipTrigger>
      <TooltipContent>{meta.help}</TooltipContent>
    </Tooltip>
  );
}

function EmptyAssignedState({
  hasAvailableKbs,
  kbsApiOk,
}: {
  hasAvailableKbs: boolean;
  kbsApiOk: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-8 gap-2">
      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
        <Database className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">No knowledge bases assigned</p>
      <p className="text-xs text-muted-foreground max-w-xs">
        {hasAvailableKbs
          ? "Pick from the picker below to grant this team access to one or more knowledge bases."
          : kbsApiOk
            ? "There are no knowledge bases to assign yet."
            : "RAG server is unreachable, so available KBs cannot be listed."}
      </p>
      {!hasAvailableKbs && kbsApiOk && (
        <a
          href="/rag"
          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Create a knowledge base
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
