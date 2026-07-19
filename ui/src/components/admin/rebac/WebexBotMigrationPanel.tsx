"use client";

import { ChevronRight, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface BotOption {
  id: string;
  name: string;
  available: boolean;
}

interface MigrationCandidate {
  workspace_id: string;
  space_id: string;
  space_name: string;
  team_mapping_count: number;
  route_count: number;
  mongo_agent_ids: string[];
  openfga_agent_ids: string[];
  mapping_details: Array<{ team_id: string; team_slug: string }>;
  mongo_route_details: Array<{ agent_id: string }>;
  openfga_grants: Array<{ user: string; relation: string; object: string }>;
}

interface MigrationResult {
  spaces_migrated: number;
  team_mappings_updated: number;
  agent_routes_updated: number;
  agent_routes_created: number;
  openfga_tuples_written: number;
  legacy_openfga_tuples_deleted: number;
}

interface CleanupResult {
  spaces_cleaned: number;
  team_mappings_deleted: number;
  agent_routes_deleted: number;
  legacy_openfga_tuples_deleted: number;
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function rowKey(row: MigrationCandidate): string {
  return `${row.workspace_id}\n${row.space_id}`;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const raw = await response.text().catch(() => "");
  if (!raw) return `${fallback}: ${response.status}`;
  try {
    const payload = JSON.parse(raw) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : `${fallback}: ${response.status}`;
  } catch {
    return raw;
  }
}

export function WebexBotMigrationPanel({ disabled }: { disabled: boolean }) {
  const { toast } = useToast();
  const [bots, setBots] = useState<BotOption[]>([]);
  const [rows, setRows] = useState<MigrationCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [botByRow, setBotByRow] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const assignments = useMemo(
    () => (rows ?? [])
      .filter((row) => selected.has(rowKey(row)) && botByRow[rowKey(row)])
      .map((row) => ({
        workspace_id: row.workspace_id,
        space_id: row.space_id,
        bot_id: botByRow[rowKey(row)],
      })),
    [botByRow, rows, selected],
  );
  const selectedCount = selected.size;
  const selectionComplete = selectedCount > 0 && assignments.length === selectedCount;
  const selectedTargets = useMemo(
    () => (rows ?? [])
      .filter((row) => selected.has(rowKey(row)))
      .map((row) => ({ workspace_id: row.workspace_id, space_id: row.space_id })),
    [rows, selected],
  );

  const probe = async () => {
    setLoading(true);
    setError(null);
    try {
      const [botsResponse, migrationResponse] = await Promise.all([
        fetch("/api/admin/webex/bots", { cache: "no-store" }),
        fetch("/api/admin/webex/migrations/bot-ownership", { cache: "no-store" }),
      ]);
      if (!botsResponse.ok) throw new Error(await responseMessage(botsResponse, "Failed to load bots"));
      if (!migrationResponse.ok) {
        throw new Error(await responseMessage(migrationResponse, "Legacy probe failed"));
      }
      const botData = apiData<{ bots?: BotOption[] }>(await botsResponse.json());
      const migrationData = apiData<{ candidates?: MigrationCandidate[] }>(await migrationResponse.json());
      setBots(botData.bots ?? []);
      setRows(migrationData.candidates ?? []);
      setSelected(new Set());
      setExpanded(new Set());
      setBotByRow({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Legacy probe failed");
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/webex/migrations/bot-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Migration failed"));
      const data = apiData<{ result: MigrationResult }>(await response.json());
      toast(`Migrated ${data.result.spaces_migrated} Webex space${data.result.spaces_migrated === 1 ? "" : "s"}.`, "success");
      setConfirmOpen(false);
      await probe();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Migration failed");
    } finally {
      setApplying(false);
    }
  };

  const deleteSelected = async () => {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/webex/migrations/bot-ownership", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: selectedTargets }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Legacy cleanup failed"));
      const data = apiData<{ result: CleanupResult }>(await response.json());
      toast(`Deleted legacy data for ${data.result.spaces_cleaned} Webex space${data.result.spaces_cleaned === 1 ? "" : "s"}.`, "success");
      setDeleteConfirmOpen(false);
      await probe();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Legacy cleanup failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <span>Botless Mongo records and legacy physical-space OpenFGA grants</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void probe()} disabled={disabled || loading || applying || deleting}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Probe legacy data
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}

      {rows !== null && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/70 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2 text-left font-medium">Use</th>
                <th className="px-3 py-2 text-left font-medium">Space</th>
                <th className="px-3 py-2 text-left font-medium">Legacy data</th>
                <th className="min-w-56 px-3 py-2 text-left font-medium">Webex bot</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = rowKey(row);
                const isExpanded = expanded.has(key);
                const detailsId = `legacy-details-${encodeURIComponent(row.workspace_id)}-${encodeURIComponent(row.space_id)}`;
                const openFgaGrantCount = row.openfga_grants?.length ?? row.openfga_agent_ids.length;
                return (
                  <Fragment key={key}>
                    <tr className="border-t align-middle">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(key)}
                        onChange={(event) => setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(key); else next.delete(key);
                          return next;
                        })}
                        disabled={disabled || applying || deleting}
                        aria-label={`Select ${row.space_name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{row.space_name}</div>
                      <div className="text-xs text-muted-foreground">{row.workspace_id} / {row.space_id}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {row.team_mapping_count > 0 && <Badge variant="outline">{countLabel(row.team_mapping_count, "mapping")}</Badge>}
                        {row.route_count > 0 && <Badge variant="outline">{countLabel(row.route_count, "Mongo route")}</Badge>}
                        {openFgaGrantCount > 0 && <Badge variant="secondary">{countLabel(openFgaGrantCount, "OpenFGA grant")}</Badge>}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          onClick={() => setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            return next;
                          })}
                        >
                          <ChevronRight
                            className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          />
                          Details
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={botByRow[key] ?? ""}
                        onChange={(event) => setBotByRow((current) => ({ ...current, [key]: event.target.value }))}
                        disabled={disabled || applying || deleting}
                        aria-label={`Webex bot for ${row.space_name}`}
                      >
                        <option value="">Select a bot</option>
                        {bots.map((bot) => (
                          <option key={bot.id} value={bot.id}>
                            {bot.name}{bot.available ? "" : " (token unavailable)"}
                          </option>
                        ))}
                      </select>
                    </td>
                    </tr>
                    {isExpanded && (
                      <tr id={detailsId} className="border-t bg-muted/25">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="min-w-0">
                            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Mongo mappings</div>
                            <ul className="space-y-1 font-mono text-xs">
                              {(row.mapping_details ?? []).map((mapping, index) => (
                                <li key={`${mapping.team_slug}-${mapping.team_id}-${index}`} className="break-all">
                                  {mapping.team_slug ? <div>team:{mapping.team_slug}</div> : null}
                                  {mapping.team_id ? <div className="text-muted-foreground">team_id:{mapping.team_id}</div> : null}
                                  {!mapping.team_slug && !mapping.team_id ? "No team identity recorded" : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="min-w-0">
                            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Mongo routes</div>
                            <ul className="space-y-1 font-mono text-xs">
                              {(row.mongo_route_details ?? row.mongo_agent_ids.map((agent_id) => ({ agent_id }))).map((route, index) => (
                                <li key={`${route.agent_id}-${index}`} className="break-all">
                                  {route.agent_id ? `agent:${route.agent_id}` : "No agent identity recorded"}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="min-w-0">
                            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">OpenFGA grants</div>
                            <ul className="space-y-2 font-mono text-xs">
                              {(row.openfga_grants ?? row.openfga_agent_ids.map((agentId) => ({
                                user: `webex_space:${row.workspace_id}--${row.space_id}`,
                                relation: "user",
                                object: `agent:${agentId}`,
                              }))).map((grant, index) => (
                                <li key={`${grant.user}-${grant.relation}-${grant.object}-${index}`} className="break-all">
                                  <div>{grant.user}</div>
                                  <div className="text-muted-foreground">{grant.relation} -&gt; {grant.object}</div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No legacy Webex space ownership found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="destructive"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={disabled || applying || deleting || selectedCount === 0}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete selected ({selectedCount})
          </Button>
          <Button type="button" onClick={() => setConfirmOpen(true)} disabled={disabled || applying || deleting || !selectionComplete}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Migrate selected ({selectedCount})
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!applying) setConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Migrate selected Webex spaces?</DialogTitle>
            <DialogDescription>
              This replaces their legacy physical-space agent grants with bot-scoped OpenFGA grants.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={applying}>Cancel</Button>
            <Button type="button" onClick={() => void apply()} disabled={applying}>
              {applying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Apply migration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => { if (!deleting) setDeleteConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete selected legacy data?</DialogTitle>
            <DialogDescription>
              This permanently removes the selected botless Mongo mappings, Mongo routes, and legacy physical-space OpenFGA grants. No bot-scoped records are changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void deleteSelected()} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Delete legacy data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
