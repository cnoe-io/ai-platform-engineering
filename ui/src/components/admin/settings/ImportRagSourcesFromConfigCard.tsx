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
 * Flow: open the popover -> preview (dry_run) lists every ingested
 * datasource alongside whether it already has a config row -> admin picks
 * which of the still-unmigrated ones to adopt plus an optional owner team
 * and shared teams -> apply calls the same endpoint with dry_run:false,
 * which creates a config row with config_import_adopted:true for exactly
 * the chosen ids and applies the team assignment ONLY to those ids (never
 * retroactively to sources outside the batch).
 */

import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AdminBadge } from "@/components/admin/shared/AdminBadge";
import { TeamOwnershipFields } from "@/components/rbac/TeamOwnershipFields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type TeamPickerOption } from "@/components/ui/team-picker";

interface PreviewSource {
  source_id: string;
  name: string;
  source_type: string;
  in_db: boolean;
  already_adopted: boolean;
}

type SkipReason = "not_found_in_redis" | "missing_identity_fields" | "already_in_db";

interface AdoptSkip {
  source_id: string;
  reason: SkipReason;
}

interface TeamOption {
  _id: string;
  name: string;
  slug?: string;
  user_role?: string | null;
  can_own_agents?: boolean;
}

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  not_found_in_redis: "not found",
  missing_identity_fields: "missing required fields",
  already_in_db: "already has a config row",
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
  const [availableTeams, setAvailableTeams] = useState<TeamOption[]>([]);
  const [ownerTeamSlug, setOwnerTeamSlug] = useState("");
  const [sharedWithTeams, setSharedWithTeams] = useState<string[]>([]);
  const [result, setResult] = useState<{ adopted: string[]; skipped: AdoptSkip[] } | null>(null);

  const importable = previewSources.filter((s) => !s.in_db);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    (async () => {
      try {
        const [previewRes, teamsRes] = await Promise.all([
          fetch("/api/admin/rag/sources/migrate-from-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dry_run: true }),
          }).then((r) => r.json()),
          fetch("/api/dynamic-agents/teams").then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (previewRes.success) {
          const sources = (previewRes.data?.sources ?? []) as PreviewSource[];
          setPreviewSources(sources);
          setSelectedIds(new Set(sources.filter((s) => !s.in_db).map((s) => s.source_id)));
        } else {
          setError(previewRes.error || "Failed to preview config");
        }
        if (teamsRes.success && Array.isArray(teamsRes.data)) {
          setAvailableTeams(teamsRes.data);
        }
      } catch {
        if (!cancelled) setError("Network error loading preview");
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
          owner_team_slug: ownerTeamSlug || null,
          shared_with_teams: sharedWithTeams,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Import failed");
        return;
      }
      setResult({ adopted: data.data.adopted ?? [], skipped: data.data.skipped ?? [] });
      setPreviewSources((prev) =>
        prev.map((s) =>
          data.data.adopted?.includes(s.source_id) ? { ...s, already_adopted: true } : s,
        ),
      );
      setSelectedIds(new Set());
    } catch {
      setError("Network error applying import");
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
          <AdminBadge />
        </CardTitle>
        <CardDescription>
          Adopt already-ingested RAG datasources into the database as config rows. Once
          adopted, a source is managed and delegated through the database — it becomes the
          source of truth for it.
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Migrate ingested RAG sources</DialogTitle>
            <DialogDescription>
              Pick the already-ingested datasources to adopt and, optionally, a team to own
              and share them with. This assignment applies only to the sources selected
              below.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
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
                  Adopted {result.adopted.length} source{result.adopted.length === 1 ? "" : "s"}.
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
                  No ingested RAG datasources found, or none are eligible for migration.
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
                        disabled={source.in_db}
                        onChange={() => toggleSelected(source.source_id)}
                        data-testid={`import-rag-source-checkbox-${source.source_id}`}
                      />
                      <span className="flex-1 truncate">{source.name}</span>
                      {source.already_adopted ? (
                        <Badge variant="secondary" className="shrink-0">
                          Already adopted
                        </Badge>
                      ) : (
                        source.in_db && (
                          <Badge variant="secondary" className="shrink-0">
                            Has config row
                          </Badge>
                        )
                      )}
                    </label>
                  ))}
                </div>
              )}

              {importable.length > 0 && (
                <TeamOwnershipFields
                  ownerTeamSlug={ownerTeamSlug}
                  sharedTeamSlugs={sharedWithTeams}
                  isEditing={false}
                  ownerRequired={false}
                  resourceNoun="imported source batch"
                  currentUserTeamSlugs={availableTeams
                    .map((t) => t.slug)
                    .filter((slug): slug is string => Boolean(slug))}
                  onOwnerTeamChange={setOwnerTeamSlug}
                  onSharedTeamsChange={setSharedWithTeams}
                  availableTeams={availableTeams
                    .filter((t): t is TeamOption & { slug: string } => Boolean(t.slug))
                    .map<TeamPickerOption>((t) => ({ slug: t.slug, name: t.name, _id: t._id }))}
                  ownerTeamOptions={availableTeams
                    .filter((t): t is TeamOption & { slug: string } => Boolean(t.slug))
                    .map<TeamPickerOption>((t) => ({
                      slug: t.slug,
                      name: t.user_role ? `${t.name} (${t.user_role})` : t.name,
                      _id: t._id,
                      disabled: t.can_own_agents === false,
                    }))}
                  ownerHelpText="Optional — leave unset to import without changing ownership on these sources."
                  shareHelpText="Additional teams that can use the imported sources."
                  disabled={applying}
                />
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={applying}>
              Close
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={loading || applying || selectedIds.size === 0}
              className="gap-2"
              data-testid="import-rag-sources-apply-button"
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Import {selectedIds.size > 0 ? selectedIds.size : ""} source
              {selectedIds.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default ImportRagSourcesFromConfigCard;
