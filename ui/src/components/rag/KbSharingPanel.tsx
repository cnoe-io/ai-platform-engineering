"use client";

import { TeamOwnershipFields } from "@/components/rbac/TeamOwnershipFields";
import { Button } from "@/components/ui/button";
import { type TeamPickerOption } from "@/components/ui/team-picker";
import { ShieldCheck,Users } from "lucide-react";
import React from "react";

interface KbSharingPanelProps {
  knowledgeBaseId: string;
}

interface SharingResponse {
  knowledge_base_id: string;
  shared_team_slugs: string[];
  owner_team_slug: string | null;
  creator_subject?: string | null;
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
  const [originalOwner, setOriginalOwner] = React.useState<string | null>(null);
  const [creatorSubject, setCreatorSubject] = React.useState<string | null>(null);
  // Ownership transfer (US3): on edit the owner picker is read-only until the
  // user invokes the transfer affordance; these track the pending transfer.
  const [transferRequested, setTransferRequested] = React.useState(false);
  const [transferConfirmedNotMember, setTransferConfirmedNotMember] = React.useState(false);
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
      setOriginalOwner(data.owner_team_slug ?? null);
      setCreatorSubject(data.creator_subject ?? null);
      setTransferRequested(false);
      setTransferConfirmedNotMember(false);
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
      // Send owner_team_slug + confirm_not_member only when the user invoked
      // the transfer affordance, so a share-only save never trips the BFF's
      // not-a-member transfer gate.
      const res = await fetch(`/api/rag/kbs/${encodeURIComponent(knowledgeBaseId)}/sharing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_slugs: selected,
          ...(transferRequested
            ? { owner_team_slug: ownerTeamSlug, confirm_not_member: transferConfirmedNotMember }
            : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Failed to save (${res.status})`);
      }
      const data = (await res.json()) as SharingResponse;
      const next = Array.isArray(data.shared_team_slugs) ? data.shared_team_slugs : selected;
      setOriginalShared(next);
      setSelected(next);
      if (data.owner_team_slug !== undefined) {
        setOwnerTeamSlug(data.owner_team_slug ?? null);
        setOriginalOwner(data.owner_team_slug ?? null);
      }
      setTransferRequested(false);
      setTransferConfirmedNotMember(false);
      setInfo(transferRequested ? "Ownership transferred." : "Sharing updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sharing");
    } finally {
      setSaving(false);
    }
  }, [knowledgeBaseId, selected, transferRequested, transferConfirmedNotMember, ownerTeamSlug]);

  const isDirty = React.useMemo(() => {
    // A pending ownership transfer (owner changed via the transfer affordance)
    // makes the form dirty even when the shared set is unchanged.
    if (transferRequested && ownerTeamSlug !== originalOwner) return true;
    if (originalShared.length !== selected.length) return true;
    const a = new Set(originalShared);
    return selected.some((slug) => !a.has(slug));
  }, [originalShared, selected, transferRequested, ownerTeamSlug, originalOwner]);

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
        <h3 className="text-sm font-semibold">Ownership &amp; Sharing</h3>
      </div>

      {/* Shared <TeamOwnershipFields> (spec 2026-06-03, US1/US5). The KB
          already exists, so the owner team is read-only until the user invokes
          the transfer affordance (US3). The component renders the owner team,
          the share multi-select, and the effective-access preview. */}
      <TeamOwnershipFields
        ownerTeamSlug={ownerTeamSlug ?? ""}
        sharedTeamSlugs={selected}
        creatorSubject={creatorSubject}
        isEditing
        allowTransfer
        resourceNoun="knowledge base"
        onTransfer={(_newOwnerSlug, confirmedNotMember) => {
          setTransferRequested(true);
          setTransferConfirmedNotMember(confirmedNotMember);
        }}
        disabled={loading || saving}
        availableTeams={options}
        currentUserTeamSlugs={options.map((o) => o.slug)}
        onOwnerTeamChange={setOwnerTeamSlug}
        onSharedTeamsChange={setSelected}
        shareHelpText={
          <>
            Grant additional teams read access to this knowledge base. Members
            of the listed teams can search and ingest into it; team admins can
            manage it. Unchecking a team genuinely revokes its access.
          </>
        }
        renderGrantDetail={(slug) => (
          <>
            members of <code>team:{slug}</code> can search and ingest into this
            knowledge base.
          </>
        )}
      />

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
