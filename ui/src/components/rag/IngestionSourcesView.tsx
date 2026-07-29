"use client";

/**
 * Ingestion Sources tab — list + create/edit orchestration
 * (spec 2026-07-21-rag-source-config-db).
 *
 * Fetches `GET /api/rag/sources`, renders one `IngestionSourceCard` per
 * result, and drives create/edit via `IngestionSourceForm`. Delete/adopt
 * are optimistic-refetch: the row action awaits the API call then reloads
 * the list rather than patching local state, since a delete/adopt also
 * changes `_permissions`/`config_import_adopted` server-side.
 */

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { RagApiError } from "@/lib/rag-api";
import { useRagPermissions } from "@/hooks/useRagPermissions";
import type { IngestionSourceConfigWithPermissions } from "@/types/ingestion-source";
import { AlertCircle, Loader2, Plug, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { IngestionSourceCard } from "./IngestionSourceCard";
import { IngestionSourceForm } from "./IngestionSourceForm";

interface SourcesResponse {
  success: boolean;
  data?: { sources: IngestionSourceConfigWithPermissions[] };
}

export default function IngestionSourcesView() {
  const { toast } = useToast();
  const { userInfo } = useRagPermissions();
  const isOrgAdmin = userInfo?.role === "ADMIN";

  const [sources, setSources] = useState<IngestionSourceConfigWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<IngestionSourceConfigWithPermissions | null>(
    null,
  );

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rag/sources");
      if (!res.ok) {
        throw new Error(`Failed to load ingestion sources (${res.status})`);
      }
      const data = (await res.json()) as SourcesResponse;
      setSources(Array.isArray(data.data?.sources) ? data.data!.sources : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ingestion sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleSave = async (payload: Record<string, unknown>) => {
    const isEdit = Boolean(editingSource);
    const url = isEdit ? `/api/rag/sources/${encodeURIComponent(editingSource!.source_id)}` : "/api/rag/sources";
    const method = isEdit ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new RagApiError(res.status, res.statusText, body?.code, body?.error);
    }
    toast(isEdit ? "Ingestion source updated." : "Ingestion source created.", "success");
    setDialogOpen(false);
    setEditingSource(null);
    await fetchSources();
  };

  const handleDelete = async (source: IngestionSourceConfigWithPermissions) => {
    try {
      const res = await fetch(`/api/rag/sources/${encodeURIComponent(source.source_id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to delete (${res.status})`);
      }
      toast(`Source "${source.name}" deleted.`, "success");
      await fetchSources();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete source", "error");
    }
  };

  const handleAdopt = async (source: IngestionSourceConfigWithPermissions) => {
    try {
      const res = await fetch(`/api/rag/sources/${encodeURIComponent(source.source_id)}/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_team_slug: source.owner_team_slug }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to adopt (${res.status})`);
      }
      toast(`Source "${source.name}" adopted.`, "success");
      await fetchSources();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to adopt source", "error");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg gradient-primary-br flex items-center justify-center shadow-md shadow-primary/20">
            <Plug className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Ingestion Sources</h1>
            <p className="text-xs text-muted-foreground">Manage where content is ingested from</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchSources} disabled={loading} className="gap-1.5">
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditingSource(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New Source
          </Button>
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-2 max-w-2xl">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && sources.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 py-8 text-center">
              <Plug className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No ingestion sources yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click <strong>New Source</strong> to configure where content is ingested from.
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            sources.map((source) => (
              <IngestionSourceCard
                key={source.source_id}
                source={source}
                isOrgAdmin={isOrgAdmin}
                onEdit={(s) => {
                  setEditingSource(s);
                  setDialogOpen(true);
                }}
                onDelete={handleDelete}
                onAdopt={handleAdopt}
              />
            ))}
        </div>
      </ScrollArea>

      <IngestionSourceForm
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingSource(null);
        }}
        onSave={handleSave}
        initial={editingSource}
      />
    </div>
  );
}
