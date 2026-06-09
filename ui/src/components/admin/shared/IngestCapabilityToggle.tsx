"use client";

import { AlertCircle,CheckCircle2,Loader2,Upload } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

/**
 * Explicit "data source author" capability toggle for a team
 * (spec 2026-06-03-explicit-ingest-capability).
 *
 * Reads/writes the org-level `ingestor` grant for this team via
 * `/api/admin/teams/[id]/ingest-capability`. This is deliberately separate
 * from per-KB assignment below it: per-KB `ingestor` means "push into KB X",
 * while THIS capability is what lets the team's members open the Ingest UI and
 * author brand-new data sources. Granting/revoking is org-admin-only (enforced
 * server-side); a 403 surfaces inline.
 *
 * assisted-by Cursor claude-opus-4.8
 */
interface IngestCapabilityToggleProps {
  teamId: string;
  teamName: string;
}

interface CapabilityState {
  can_author_data_sources: boolean;
}

export function IngestCapabilityToggle({
  teamId,
  teamName,
}: IngestCapabilityToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/teams/${teamId}/ingest-capability`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { data: CapabilityState };
      setEnabled(Boolean(data.data?.can_author_data_sources));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load ingest capability"
      );
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const handleToggle = async () => {
    const next = !enabled;
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/admin/teams/${teamId}/ingest-capability`, {
        method: next ? "PUT" : "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      setEnabled(next);
      flashSuccess(
        next
          ? `${teamName} can now create data sources`
          : `${teamName} can no longer create data sources`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update ingest capability"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border bg-background">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-8 w-8 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0">
            <Upload className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-medium">Create / ingest data sources</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Allow <strong>{teamName}</strong> members to author brand-new data
              sources (web / Confluence). This is separate from the per-KB
              permissions below, which only control pushing into existing
              knowledge bases.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Allow this team to create data sources"
          disabled={loading || saving}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
            enabled ? "bg-amber-500" : "bg-muted-foreground/30"
          }`}
        >
          {loading || saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto text-background" />
          ) : (
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          )}
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-2 px-4 pb-3 text-destructive text-xs">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 px-4 pb-3 text-emerald-600 dark:text-emerald-300 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}
    </section>
  );
}
