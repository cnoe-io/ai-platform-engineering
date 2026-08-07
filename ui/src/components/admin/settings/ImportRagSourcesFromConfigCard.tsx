"use client";

/**
 * Admin -> Settings -> General pane for adopting already-ingested RAG
 * datasources into the DB as source of truth (spec
 * 2026-07-21-rag-source-config-db, US5) — mirrors
 * `ImportAgentsFromConfigCard.tsx`, adapted for `rag_ingestion_sources`
 * where the preview is sourced from the RAG server's `DataSourceInfo`
 * records (the BFF cannot read ingestor-pod env vars) and skips carry a
 * `reason`.
 *
 * Flow: the preview lists sources originating in environment configuration,
 * including disabled rows for prior imports. Applying creates editable
 * settings where supported and adds the sources to Platform RAG without
 * changing that collection's Owner or Search access.
 */

import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PreviewSource {
  source_id: string;
  name: string;
  source_type: string;
  in_db: boolean;
  already_adopted: boolean;
  importable: boolean;
}

type SkipReason =
  | "not_found_in_redis"
  | "missing_identity_fields"
  | "already_in_db";

interface AdoptSkip {
  source_id: string;
  reason: SkipReason;
}

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  not_found_in_redis: "not found",
  missing_identity_fields: "missing required settings",
  already_in_db: "already imported",
};

interface ImportRagSourcesFromConfigCardProps {
  isAdmin: boolean;
  readOnly?: boolean;
}

export function ImportRagSourcesFromConfigCard({
  isAdmin,
  readOnly = false,
}: ImportRagSourcesFromConfigCardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSources, setPreviewSources] = useState<PreviewSource[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [platformSourceCount, setPlatformSourceCount] = useState(0);
  const [result, setResult] = useState<{
    adopted: string[];
    skipped: AdoptSkip[];
    platformSourceCount: number;
    agentsUpdated: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    (async () => {
      try {
        const previewRes = await fetch(
          "/api/admin/rag/sources/migrate-from-config",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dry_run: true }),
          },
        ).then((response) => response.json());
        if (cancelled) return;
        if (previewRes.success) {
          const sources = (
            (previewRes.data?.sources ?? []) as PreviewSource[]
          ).filter((source) => source.importable || source.already_adopted);
          setPlatformSourceCount(
            previewRes.data?.platform_collection?.source_count ?? 0,
          );
          setPreviewSources(sources);
          setSelectedIds(
            new Set(
              sources.filter((s) => s.importable).map((s) => s.source_id),
            ),
          );
        } else {
          setError(
            previewRes.error ||
              "Could not load sources from environment configuration",
          );
        }
      } catch {
        if (!cancelled) setError("Could not load the source preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApply() {
    if (readOnly) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rag/sources/migrate-from-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dry_run: false,
          source_ids: Array.from(selectedIds),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Import failed");
        return;
      }
      setResult({
        adopted: data.data.adopted ?? [],
        skipped: data.data.skipped ?? [],
        platformSourceCount: data.data.platform_collection?.source_count ?? 0,
        agentsUpdated: data.data.platform_collection?.agents_updated ?? 0,
      });
      setPreviewSources((prev) =>
        prev.map((s) =>
          data.data.adopted?.includes(s.source_id)
            ? {
                ...s,
                in_db: true,
                already_adopted: true,
                importable: false,
              }
            : s,
        ),
      );
      setSelectedIds(new Set());
    } catch {
      setError("Could not import the selected sources");
    } finally {
      setApplying(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Migrate Ingested RAG Sources
        </CardTitle>
        <CardDescription>
          Import sources from environment configuration into Platform RAG.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => {
            if (!readOnly) setOpen(true);
          }}
          disabled={readOnly}
          data-testid="import-rag-sources-from-config-button"
        >
          <FileUp className="h-4 w-4" />
          Migrate Sources
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !applying && setOpen(next)}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] min-w-0 flex-col overflow-visible sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Migrate ingested RAG sources</DialogTitle>
            <DialogDescription>
              <span className="block">
                Import sources from environment configuration into Platform RAG.
              </span>
              <span className="mt-1 block">
                Platform RAG keeps its current Owner and Search access.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="min-w-0 space-y-4">
                {error && (
                  <div
                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    data-testid="import-rag-sources-error"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                {result && (
                  <div
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
                    data-testid="import-rag-sources-result"
                  >
                    Platform RAG now contains {result.platformSourceCount} source
                    {result.platformSourceCount === 1 ? "" : "s"}.
                    {result.adopted.length > 0 && (
                      <>
                        {" "}
                        Imported {result.adopted.length} source
                        {result.adopted.length === 1 ? "" : "s"}.
                      </>
                    )}
                    {result.agentsUpdated > 0 && (
                      <>
                        {" "}
                        Updated {result.agentsUpdated} existing agent
                        {result.agentsUpdated === 1 ? "" : "s"}.
                      </>
                    )}
                    {result.skipped.length > 0 && (
                      <ul className="mt-1 list-disc pl-5">
                        {result.skipped.map((skip) => (
                          <li key={skip.source_id}>
                            {skip.source_id}: {SKIP_REASON_LABEL[skip.reason]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {previewSources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No sources from environment configuration are available to
                    import. You can still update Platform RAG access below.
                  </p>
                ) : (
                  <div
                    className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2"
                    data-testid="import-rag-sources-checklist"
                  >
                    {previewSources.map((source) => (
                      <label
                        key={source.source_id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(source.source_id)}
                          disabled={!source.importable}
                          onChange={() => toggleSelected(source.source_id)}
                          data-testid={`import-rag-source-checkbox-${source.source_id}`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {source.name}
                        </span>
                        {source.already_adopted ? (
                          <Badge variant="secondary" className="shrink-0">
                            Already imported
                          </Badge>
                        ) : null}
                      </label>
                    ))}
                  </div>
                )}

                <p className="min-w-0 break-words text-xs text-muted-foreground">
                  Platform RAG will include {platformSourceCount} source
                  {platformSourceCount === 1 ? "" : "s"} from environment
                  configuration. Other configured sources are included
                  automatically, even when they are not listed above.
                </p>

                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">Destination: Platform RAG</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Imported sources use Platform RAG&apos;s Owner and Search
                    access while they remain in the collection.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="min-w-0 flex-wrap gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={applying}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={loading || applying}
              className="gap-2"
              data-testid="import-rag-sources-apply-button"
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Migrate to Platform RAG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default ImportRagSourcesFromConfigCard;
