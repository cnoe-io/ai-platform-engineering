"use client";

import React from "react";
import { TeamMultiPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface KbSharingPanelProps {
  knowledgeBaseId: string;
}

interface SharingResponse {
  knowledge_base_id: string;
  shared_team_slugs: string[];
  owner_team_slug: string | null;
}

interface TeamRow {
  _id?: string;
  slug?: string;
  name?: string;
}

/**
 * "Share with Teams" panel for a single Knowledge Base.
 *
 * Mirrors the Agent editor's UX (`DynamicAgentEditor` → `TeamMultiPicker`
 * + Effective-Access callout) so operators have one mental model for
 * sharing across both resource types.
 *
 * Backed by `GET/PUT /api/rag/kbs/[id]/sharing`; the panel computes the
 * effective access summary client-side so the admin can see exactly which
 * team grants the upcoming save will write or revoke.
 */
export function KbSharingPanel({ knowledgeBaseId }: KbSharingPanelProps) {
  const [availableTeams, setAvailableTeams] = React.useState<TeamRow[]>([]);
  const [originalShared, setOriginalShared] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [ownerTeamSlug, setOwnerTeamSlug] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const fetchTeams = React.useCallback(async () => {
    try {
      const res = await fetch("/api/dynamic-agents/teams");
      const data = (await res.json()) as { success?: boolean; data?: TeamRow[] };
      if (data?.success && Array.isArray(data.data)) {
        setAvailableTeams(data.data);
      }
    } catch {
      // Non-fatal: the picker simply shows nothing to choose from.
    }
  }, []);

  const fetchSharing = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rag/kbs/${encodeURIComponent(knowledgeBaseId)}/sharing`);
      if (!res.ok) {
        throw new Error(`Failed to load sharing (${res.status})`);
      }
      const data = (await res.json()) as SharingResponse;
      const slugs = Array.isArray(data.shared_team_slugs) ? data.shared_team_slugs : [];
      setOriginalShared(slugs);
      setSelected(slugs);
      setOwnerTeamSlug(data.owner_team_slug ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sharing");
    } finally {
      setLoading(false);
    }
  }, [knowledgeBaseId]);

  React.useEffect(() => {
    fetchTeams();
    fetchSharing();
  }, [fetchTeams, fetchSharing]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/rag/kbs/${encodeURIComponent(knowledgeBaseId)}/sharing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_slugs: selected }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Failed to save (${res.status})`);
      }
      const data = (await res.json()) as SharingResponse;
      const next = Array.isArray(data.shared_team_slugs) ? data.shared_team_slugs : selected;
      setOriginalShared(next);
      setSelected(next);
      setInfo("Sharing updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sharing");
    } finally {
      setSaving(false);
    }
  }, [knowledgeBaseId, selected]);

  const isDirty = React.useMemo(() => {
    if (originalShared.length !== selected.length) return true;
    const a = new Set(originalShared);
    return selected.some((slug) => !a.has(slug));
  }, [originalShared, selected]);

  const additions = React.useMemo(
    () => selected.filter((slug) => !originalShared.includes(slug)),
    [originalShared, selected],
  );
  const removals = React.useMemo(
    () => originalShared.filter((slug) => !selected.includes(slug)),
    [originalShared, selected],
  );

  const options = React.useMemo<TeamPickerOption[]>(
    () =>
      availableTeams
        .filter((team): team is TeamRow & { slug: string } => Boolean(team.slug))
        .map((team) => ({
          slug: team.slug,
          name: team.name ?? team.slug,
          _id: team._id,
        })),
    [availableTeams],
  );

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Share with Teams</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        Grant additional teams read access to this knowledge base. Members of the listed teams
        will be able to search this KB and ingest into it; team admins can manage it. Unchecking
        a team here genuinely revokes its access — no dangling tuple is left behind.
      </p>

      <div className="space-y-2">
        <label
          htmlFor={`kb-share-picker-${knowledgeBaseId}`}
          className="block text-xs font-medium text-foreground"
        >
          Shared with
        </label>
        <TeamMultiPicker
          id={`kb-share-picker-${knowledgeBaseId}`}
          options={options}
          selected={selected}
          onChange={setSelected}
          disabled={loading || saving}
          placeholder="Pick one or more teams to share with..."
          searchPlaceholder="Search your teams..."
          emptyLabel="No teams match"
        />
      </div>

      {isDirty && (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            "border-amber-300/50 bg-amber-50/40 text-amber-900",
            "dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200",
          )}
          data-testid="kb-share-effective-access"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Effective access on save
          </div>
          <ul className="mt-1 space-y-0.5">
            {ownerTeamSlug && (
              <li>
                Owner team <code>team:{ownerTeamSlug}</code> remains the canonical owner.
              </li>
            )}
            {additions.length > 0 && (
              <li>
                <span className="font-medium">Add</span>{" "}
                {additions.map((slug) => (
                  <code key={`add-${slug}`} className="mr-1">
                    team:{slug}
                  </code>
                ))}
                — reader + admin manager tuples will be written.
              </li>
            )}
            {removals.length > 0 && (
              <li>
                <span className="font-medium">Revoke</span>{" "}
                {removals.map((slug) => (
                  <code key={`rm-${slug}`} className="mr-1">
                    team:{slug}
                  </code>
                ))}
                — existing reader + manager tuples will be deleted.
              </li>
            )}
          </ul>
        </div>
      )}

      {info && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-300/50 bg-emerald-50/30 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {info}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelected(originalShared)}
          disabled={loading || saving || !isDirty}
        >
          Reset
        </Button>
        <Button onClick={handleSave} disabled={loading || saving || !isDirty} size="sm">
          {saving ? "Saving…" : "Save sharing"}
        </Button>
      </div>
    </div>
  );
}
