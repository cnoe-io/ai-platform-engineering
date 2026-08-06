"use client";

import {
  AccessSubjectMultiPicker,
  AccessSubjectPicker,
  type AccessSubjectOption,
  type AccessSubjectRef,
} from "@/components/ui/access-subject-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { type TeamPickerOption } from "@/components/ui/team-picker";
import { useToast } from "@/components/ui/toast";
import { AlertTriangle, Layers3, UserRound } from "lucide-react";
import React from "react";
import type { RagCollectionMembershipLabel } from "@/types/rag-collection";

interface KbSharingPanelProps {
  knowledgeBaseId: string;
  onSaved?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface SharingIdentity extends AccessSubjectOption {
  email?: string | null;
}

interface SharingResponse {
  knowledge_base_id: string;
  shared_team_slugs: string[];
  shared_user_subjects?: string[];
  owner_team_slug: string | null;
  owner_subject?: string | null;
  creator_subject?: string | null;
  owner?: SharingIdentity | null;
  creator?: SharingIdentity | null;
  search_access?: SharingIdentity[];
  rag_collections?: RagCollectionMembershipLabel[];
}

interface TeamRow {
  _id?: string;
  slug?: string;
  name?: string;
}

function sameRef(left: AccessSubjectRef | null, right: AccessSubjectRef | null): boolean {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.id === right.id;
}

function sameRefs(left: AccessSubjectRef[], right: AccessSubjectRef[]): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map((ref) => `${ref.kind}:${ref.id}`));
  return left.every((ref) => rightKeys.has(`${ref.kind}:${ref.id}`));
}

function fallbackOwner(data: SharingResponse): AccessSubjectRef | null {
  if (data.owner) return { kind: data.owner.kind, id: data.owner.id };
  if (data.owner_team_slug) return { kind: "team", id: data.owner_team_slug };
  if (data.owner_subject) return { kind: "user", id: data.owner_subject };
  return null;
}

function fallbackSearchAccess(data: SharingResponse): AccessSubjectRef[] {
  if (Array.isArray(data.search_access)) {
    return data.search_access.map(({ kind, id }) => ({ kind, id }));
  }
  return [
    ...(data.shared_team_slugs ?? []).map((id) => ({ kind: "team" as const, id })),
    ...(data.shared_user_subjects ?? []).map((id) => ({ kind: "user" as const, id })),
  ];
}

function userOptions(data: SharingResponse): AccessSubjectOption[] {
  const candidates = [data.owner, data.creator, ...(data.search_access ?? [])];
  const bySubject = new Map<string, AccessSubjectOption>();
  for (const candidate of candidates) {
    if (!candidate || candidate.kind !== "user" || !candidate.id) continue;
    bySubject.set(candidate.id, candidate);
  }
  return [...bySubject.values()];
}

function subjectLabel(
  ref: AccessSubjectRef | null,
  teams: TeamPickerOption[],
  users: AccessSubjectOption[],
): string {
  if (!ref) return "the new owner";
  if (ref.kind === "team") {
    return teams.find((team) => team.slug === ref.id)?.name ?? ref.id;
  }
  const user = users.find((candidate) => candidate.id === ref.id);
  return user?.name || user?.email || "the selected person";
}

/** Manage management ownership separately from who may search/ingest a KB. */
export function KbSharingPanel({ knowledgeBaseId, onSaved, onCancel }: KbSharingPanelProps) {
  const { toast } = useToast();
  const [availableTeams, setAvailableTeams] = React.useState<TeamRow[]>([]);
  const [knownUsers, setKnownUsers] = React.useState<AccessSubjectOption[]>([]);
  const [owner, setOwner] = React.useState<AccessSubjectRef | null>(null);
  const [originalOwner, setOriginalOwner] = React.useState<AccessSubjectRef | null>(null);
  const [searchAccess, setSearchAccess] = React.useState<AccessSubjectRef[]>([]);
  const [originalSearchAccess, setOriginalSearchAccess] = React.useState<AccessSubjectRef[]>([]);
  const [creator, setCreator] = React.useState<SharingIdentity | null>(null);
  const [ragCollections, setRagCollections] = React.useState<RagCollectionMembershipLabel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [transferNeedsServerConfirm, setTransferNeedsServerConfirm] = React.useState(false);

  const fetchTeams = React.useCallback(async () => {
    try {
      const response = await fetch("/api/dynamic-agents/teams");
      const data = (await response.json()) as { success?: boolean; data?: TeamRow[] };
      if (data.success && Array.isArray(data.data)) setAvailableTeams(data.data);
    } catch {
      // The people picker remains usable if the team directory is unavailable.
    }
  }, []);

  const applySharing = React.useCallback((data: SharingResponse) => {
    const nextOwner = fallbackOwner(data);
    const nextSearch = fallbackSearchAccess(data);
    setOwner(nextOwner);
    setOriginalOwner(nextOwner);
    setSearchAccess(nextSearch);
    setOriginalSearchAccess(nextSearch);
    setKnownUsers(userOptions(data));
    setCreator(data.creator ?? null);
    setRagCollections(data.rag_collections ?? []);
    setTransferNeedsServerConfirm(false);
  }, []);

  const fetchSharing = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/rag/kbs/${encodeURIComponent(knowledgeBaseId)}/sharing`,
      );
      if (!response.ok) throw new Error(`Failed to load access (${response.status})`);
      applySharing((await response.json()) as SharingResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load access");
    } finally {
      setLoading(false);
    }
  }, [applySharing, knowledgeBaseId]);

  React.useEffect(() => {
    void Promise.all([fetchTeams(), fetchSharing()]);
  }, [fetchSharing, fetchTeams]);

  const teams = React.useMemo<TeamPickerOption[]>(
    () => availableTeams.flatMap((team) => team.slug ? [{
      slug: team.slug,
      name: team.name ?? team.slug,
      _id: team._id,
    }] : []),
    [availableTeams],
  );

  const ownerChanged = !sameRef(owner, originalOwner);
  const isDirty = ownerChanged || !sameRefs(searchAccess, originalSearchAccess);

  const handleSave = React.useCallback(async (forceConfirm = false) => {
    if (!owner) {
      setError("Select a person or team to manage this data source.");
      return;
    }
    setSaving(true);
    setError(null);
    setTransferNeedsServerConfirm(false);
    try {
      const response = await fetch(
        `/api/rag/kbs/${encodeURIComponent(knowledgeBaseId)}/sharing`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner,
            search_access: searchAccess,
            // The changed-owner warning and explicit Transfer & save button are
            // the confirmation. A retry also covers policy drift between load
            // and save.
            confirm_not_member: forceConfirm || ownerChanged,
          }),
        },
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        if (
          detail?.code === "TRANSFER_NOT_MEMBER_UNCONFIRMED" ||
          detail?.code === "TRANSFER_CONFIRMATION_REQUIRED"
        ) {
          setTransferNeedsServerConfirm(true);
          setError(detail.error ?? "Confirm the ownership transfer to continue.");
          return;
        }
        throw new Error(detail?.error ?? `Failed to save access (${response.status})`);
      }
      applySharing((await response.json()) as SharingResponse);
      toast(ownerChanged ? "Datasource ownership and access updated." : "Datasource access updated.", "success");
      await onSaved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to save access");
    } finally {
      setSaving(false);
    }
  }, [applySharing, knowledgeBaseId, onSaved, owner, ownerChanged, searchAccess, toast]);

  const handleCancel = () => {
    setOwner(originalOwner);
    setSearchAccess(originalSearchAccess);
    setError(null);
    setTransferNeedsServerConfirm(false);
    onCancel?.();
  };

  const creatorLabel = creator
    ? creator.name || creator.email || "Unknown user"
    : null;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div>
          <Label htmlFor="datasource-owner">Management owner</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            One person or team manages settings, reloads, transfers, and deletion.
          </p>
        </div>
        <AccessSubjectPicker
          id="datasource-owner"
          value={owner}
          onChange={setOwner}
          teams={teams}
          knownUsers={knownUsers}
          disabled={loading || saving}
          placeholder={loading ? "Loading owner..." : "Select a person or team"}
          searchPlaceholder="Search people or teams..."
          ariaLabel="Management owner"
        />
        {creatorLabel && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" />
            Created by <span className="text-foreground">{creatorLabel}</span>
            {creator?.email && creator.email !== creatorLabel && (
              <span>({creator.email})</span>
            )}
          </p>
        )}
      </section>

      <section className="space-y-2 border-t border-border/60 pt-4">
        <div>
          <Label>Search &amp; ingest access</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Selected people and teams can query this data, including through agents, and ingest into it. A personal owner always has access; a team management owner does not unless it is selected below.
          </p>
        </div>
        <AccessSubjectMultiPicker
          selected={searchAccess.filter(
            (ref) => !(owner?.kind === "user" && sameRef(ref, owner)),
          )}
          onChange={setSearchAccess}
          teams={teams}
          knownUsers={knownUsers}
          implicitSelections={owner?.kind === "user" ? [owner] : []}
          implicitSelectionLabel="Access included through personal ownership"
          disabled={loading || saving}
          placeholder={owner?.kind === "user"
            ? "Only the personal owner can search — add others"
            : "No search access — add people or teams"}
          searchPlaceholder="Search people or teams..."
          ariaLabel="Search and ingest access"
          maxSelections={100}
          maxSelectionsByKind={{ team: 50, user: 50 }}
        />
      </section>

      {ragCollections.length > 0 && (
        <section className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Layers3 className="h-4 w-4 text-primary" />
            Inherited collection access
          </div>
          <p className="text-xs text-muted-foreground">
            These maintained collections also grant search access. Change their audience or remove this datasource from the collection to revoke it here.
          </p>
          <div className="flex flex-wrap gap-2">
            {ragCollections.map((collection) => (
              <Badge key={collection.id} variant="outline">
                {collection.name}
                {collection.reader_team_slugs.length > 0
                  ? ` · ${collection.reader_team_slugs.join(", ")}`
                  : ""}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {ownerChanged && (
        <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>
            Ownership will move to {subjectLabel(owner, teams, knownUsers)}. You may lose access after saving unless you also have Search Access.
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p>{error}</p>
          {transferNeedsServerConfirm && (
            <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void handleSave(true)}>
              Confirm transfer
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={loading || saving || !isDirty || !owner} size="sm">
          {saving ? "Saving…" : ownerChanged ? "Transfer & save" : "Save access"}
        </Button>
      </div>
    </div>
  );
}
