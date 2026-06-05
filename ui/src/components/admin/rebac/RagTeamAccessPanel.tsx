"use client";

import { useCallback, useEffect, useState } from "react";

import { SaveButton } from "@/components/admin/SaveButton";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";

interface CatalogTeam {
  id: string;
  slug: string;
  name: string;
}

interface CatalogKnowledgeBase {
  id: string;
  name: string;
  description?: string;
}

interface CatalogResponse {
  teams: CatalogTeam[];
  resources?: {
    knowledge_bases?: CatalogKnowledgeBase[];
  };
}

type KbPermission = "read" | "ingest" | "admin";

interface KbAssignmentsResponse {
  kb_ids: string[];
  kb_permissions?: Record<string, KbPermission>;
}

interface TupleRecord {
  key?: { user: string; relation: string; object: string };
}

// Map an OpenFGA base relation back to the UI permission label. Both the
// knowledge_base and data_source types share this relation vocabulary.
const RELATION_TO_PERMISSION: Record<string, KbPermission> = {
  reader: "read",
  ingestor: "ingest",
  manager: "admin",
};

interface TeamKbGrant {
  datasourceId: string;
  permission: KbPermission;
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

export function RagTeamAccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const [teams, setTeams] = useState<CatalogTeam[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<CatalogKnowledgeBase[]>([]);
  const [teamAccessTeamId, setTeamAccessTeamId] = useState("");
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<KbPermission>("read");
  const [grants, setGrants] = useState<TeamKbGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [publicDatasourceId, setPublicDatasourceId] = useState("");
  const [publicEnabled, setPublicEnabled] = useState(false);
  // Last-saved value of the per-datasource public toggle, so the shared
  // SaveButton can gate on dirty.
  const [savedPublicEnabled, setSavedPublicEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [publicMessage, setPublicMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Drives the inline "Saved"/error flash on the shared SaveButtons. We keep a
  // discriminator so each section's button only flashes for its own save.
  const [saveResult, setSaveResult] = useState<{
    section: "kbAccess" | "public";
    result: "success" | "error";
  } | null>(null);

  const selectedTeam = teams.find((team) => team.id === teamAccessTeamId);
  const teamAccessSlug = selectedTeam?.slug ?? teamAccessTeamId;

  const kbNameById = useCallback(
    (id: string) => knowledgeBases.find((kb) => kb.id === id)?.name || id,
    [knowledgeBases],
  );

  const loadCatalog = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/openfga/catalog");
    if (!res.ok) throw new Error(`Failed to load catalog: ${res.status}`);
    const payload = await res.json();
    const data = apiData<CatalogResponse>(payload);
    const nextTeams = data.teams ?? [];
    const nextKnowledgeBases = data.resources?.knowledge_bases ?? [];
    setTeams(nextTeams);
    setKnowledgeBases(nextKnowledgeBases);
    setTeamAccessTeamId((prev) => prev || nextTeams[0]?.id || "");
    setSelectedKnowledgeBaseId((prev) => prev || nextKnowledgeBases[0]?.id || "");
    setPublicDatasourceId((prev) => prev || nextKnowledgeBases[0]?.id || "");
  }, []);

  // Load the team's current per-datasource grants from OpenFGA so admins
  // can see (and revoke) what's already granted instead of guessing.
  // We read the data_source tuples — those are the ones query enforcement
  // honors — and fall back to knowledge_base for any not yet mirrored.
  const loadGrants = useCallback(async () => {
    if (!teamAccessTeamId) {
      setGrants([]);
      setGrantsError(null);
      return;
    }
    setGrantsLoading(true);
    setGrantsError(null);
    try {
      const usersets = [`team:${teamAccessSlug}#member`, `team:${teamAccessSlug}#admin`];
      const pages = await Promise.all(
        usersets.map(async (user) => {
          const params = new URLSearchParams({ user, limit: "100" });
          const res = await fetch(`/api/admin/openfga/tuples?${params.toString()}`);
          if (!res.ok) throw new Error(`Failed to load grants: ${res.status}`);
          const payload = await res.json();
          return apiData<{ tuples: TupleRecord[] }>(payload).tuples ?? [];
        }),
      );

      // Highest permission wins per datasource (admin > ingest > read).
      const rank: Record<KbPermission, number> = { read: 1, ingest: 2, admin: 3 };
      const byId = new Map<string, KbPermission>();
      for (const tuple of pages.flat()) {
        const key = tuple.key;
        if (!key) continue;
        const match = /^(knowledge_base|data_source):(.+)$/.exec(key.object);
        if (!match) continue;
        const permission = RELATION_TO_PERMISSION[key.relation];
        if (!permission) continue;
        const id = match[2];
        const existing = byId.get(id);
        if (!existing || rank[permission] > rank[existing]) byId.set(id, permission);
      }
      setGrants(
        [...byId.entries()]
          .map(([datasourceId, permission]) => ({ datasourceId, permission }))
          .sort((a, b) => a.datasourceId.localeCompare(b.datasourceId)),
      );
    } catch (err) {
      setGrantsError(err instanceof Error ? err.message : "Failed to load team grants");
    } finally {
      setGrantsLoading(false);
    }
  }, [teamAccessSlug, teamAccessTeamId]);

  const loadPublicState = useCallback(async () => {
    if (!publicDatasourceId) {
      setPublicEnabled(false);
      setSavedPublicEnabled(false);
      setPublicError(null);
      return;
    }
    setPublicError(null);
    try {
      const params = new URLSearchParams({ datasource_id: publicDatasourceId });
      const res = await fetch(`/api/admin/rag/public-datasources?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load public state: ${res.status}`);
      const payload = await res.json();
      const enabled = Boolean(apiData<{ public: boolean }>(payload).public);
      setPublicEnabled(enabled);
      setSavedPublicEnabled(enabled);
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : "Failed to load public datasource state");
    }
  }, [publicDatasourceId]);

  useEffect(() => {
    void loadCatalog().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load RAG team access catalog");
    });
  }, [loadCatalog]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  useEffect(() => {
    void loadPublicState();
  }, [loadPublicState]);

  async function saveKnowledgeBaseAccess() {
    if (!teamAccessTeamId || !selectedKnowledgeBaseId || !isAdmin) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setSaveResult(null);
    try {
      const url = `/api/admin/teams/${encodeURIComponent(teamAccessTeamId)}/kb-assignments`;
      const currentRes = await fetch(url);
      if (!currentRes.ok) {
        throw new Error(`Failed to load current KB assignments: ${currentRes.status}`);
      }
      const currentPayload = await currentRes.json();
      const current = apiData<KbAssignmentsResponse>(currentPayload);
      const kbIds = Array.from(new Set([...(current.kb_ids ?? []), selectedKnowledgeBaseId]));
      const kbPermissions = {
        ...(current.kb_permissions ?? {}),
        [selectedKnowledgeBaseId]: selectedPermission,
      };
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kb_ids: kbIds,
          kb_permissions: kbPermissions,
        }),
      });
      if (!res.ok) throw new Error(`Failed to save KB access: ${res.status}`);
      setMessage("Knowledge Base access saved to OpenFGA");
      setSaveResult({ section: "kbAccess", result: "success" });
      await loadGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Knowledge Base access save failed");
      setSaveResult({ section: "kbAccess", result: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant(datasourceId: string) {
    if (!teamAccessTeamId || !isAdmin) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const url = `/api/admin/teams/${encodeURIComponent(
        teamAccessTeamId,
      )}/kb-assignments?datasource_id=${encodeURIComponent(datasourceId)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to revoke access: ${res.status}`);
      setMessage(`Revoked access to ${kbNameById(datasourceId)}`);
      await loadGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  async function savePublicState() {
    if (!publicDatasourceId || !isAdmin) return;
    setBusy(true);
    setPublicError(null);
    setPublicMessage(null);
    setSaveResult(null);
    try {
      const res = await fetch("/api/admin/rag/public-datasources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasource_id: publicDatasourceId, public: publicEnabled }),
      });
      if (!res.ok) throw new Error(`Failed to save public datasource state: ${res.status}`);
      setPublicMessage(
        publicEnabled
          ? `${kbNameById(publicDatasourceId)} is now readable by all authenticated users`
          : `${kbNameById(publicDatasourceId)} is no longer public`,
      );
      setSavedPublicEnabled(publicEnabled);
      setSaveResult({ section: "public", result: "success" });
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : "Public datasource save failed");
      setSaveResult({ section: "public", result: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>RAG Team Access</CardTitle>
        <CardDescription>
          Manage which datasources a team can use and which datasources are readable by everyone.
          Datasource access is deny-by-default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}

        <div className="grid gap-2 md:max-w-sm">
          <Label htmlFor="rag-team-access-team">Team</Label>
          {/* Switched from native <select> to TeamPicker on
              2026-05-27 — environments with hundreds of teams made
              the dropdown unusable. The KB-assignment routes address
              teams by the catalog `id`, so we map `slug → team.id`
              and pass `hideSlugSuffix` to suppress the noisy
              `team:<uuid>` annotation. */}
          <TeamPicker
            id="rag-team-access-team"
            value={teamAccessTeamId}
            onChange={setTeamAccessTeamId}
            disabled={!isAdmin}
            placeholder={teams.length === 0 ? "No teams configured" : "Select a team"}
            searchPlaceholder="Search teams..."
            hideSlugSuffix
            options={teams.map<TeamPickerOption>((team) => ({
              slug: team.id,
              name: team.name || team.slug,
              id: team.id,
            }))}
          />
        </div>

        {/* ── Knowledge Base access ────────────────────────────────────── */}
        <section className="space-y-4 rounded-md border p-4">
          <div>
            <h3 className="text-sm font-semibold">Knowledge Base access</h3>
            <p className="text-xs text-muted-foreground">
              Which datasources this team can read, ingest, or administer. These grants are what
              let team members actually search the datasource.
            </p>
          </div>
          {grantsError && <p className="text-sm text-destructive">{grantsError}</p>}

          {/* Current grants for the selected team */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Current grants{selectedTeam ? ` · ${selectedTeam.name || selectedTeam.slug}` : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadGrants}
                disabled={!teamAccessTeamId || grantsLoading}
              >
                {grantsLoading ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
            {grants.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {grantsLoading
                  ? "Loading grants..."
                  : "No datasource grants for this team yet."}
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {grants.map((grant) => (
                  <li
                    key={grant.datasourceId}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {kbNameById(grant.datasourceId)}
                      </span>
                      <code className="block truncate text-[10px] text-muted-foreground">
                        {grant.datasourceId}
                      </code>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs capitalize">
                        {grant.permission}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        disabled={!isAdmin || busy}
                        onClick={() => revokeGrant(grant.datasourceId)}
                      >
                        Revoke
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add a grant */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
            <div className="grid gap-2">
              <Label htmlFor="rag-team-access-kb">Knowledge Base</Label>
              <select
                id="rag-team-access-kb"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedKnowledgeBaseId}
                disabled={!isAdmin || busy || knowledgeBases.length === 0}
                onChange={(event) => setSelectedKnowledgeBaseId(event.target.value)}
              >
                {knowledgeBases.length === 0 ? (
                  <option value="">No Knowledge Bases discovered</option>
                ) : (
                  knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name || kb.id}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rag-team-access-permission">Permission</Label>
              <select
                id="rag-team-access-permission"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedPermission}
                disabled={!isAdmin || busy}
                onChange={(event) => setSelectedPermission(event.target.value as KbPermission)}
              >
                <option value="read">Read</option>
                <option value="ingest">Ingest</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <SaveButton
                ariaLabel="Grant KB Access"
                onSave={saveKnowledgeBaseAccess}
                saving={busy}
                // Additive grant: enabled until the selected KB already holds
                // exactly this permission. After a save loadGrants() refreshes
                // the list, this flips to false and the "Saved" flash shows.
                dirty={
                  !grants.some(
                    (grant) =>
                      grant.datasourceId === selectedKnowledgeBaseId &&
                      grant.permission === selectedPermission,
                  )
                }
                hideDirtyBadge
                disabled={!isAdmin || !teamAccessTeamId || !selectedKnowledgeBaseId}
                result={saveResult?.section === "kbAccess" ? saveResult.result : null}
                size="default"
              />
            </div>
          </div>
        </section>

        {/* ── Public datasources ───────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border p-4">
          <div>
            <h3 className="text-sm font-semibold">Public datasources</h3>
            <p className="text-xs text-muted-foreground">
              Make a datasource readable by <strong>every authenticated user</strong> regardless of
              team. Use this for the pre-RBAC datasources that should stay broadly readable. Writes{" "}
              <code className="rounded bg-muted px-1">user:* reader</code> on the knowledge base and
              its data source.
            </p>
          </div>
          {publicError && <p className="text-sm text-destructive">{publicError}</p>}
          {publicMessage && (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">{publicMessage}</p>
          )}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-2">
              <Label htmlFor="rag-public-kb">Datasource</Label>
              <select
                id="rag-public-kb"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={publicDatasourceId}
                disabled={!isAdmin || busy || knowledgeBases.length === 0}
                onChange={(event) => setPublicDatasourceId(event.target.value)}
              >
                {knowledgeBases.length === 0 ? (
                  <option value="">No Knowledge Bases discovered</option>
                ) : (
                  knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name || kb.id}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="flex items-end">
              <SaveButton
                ariaLabel="Save Public Access"
                onSave={savePublicState}
                saving={busy}
                dirty={publicEnabled !== savedPublicEnabled}
                disabled={!isAdmin || !publicDatasourceId}
                result={saveResult?.section === "public" ? saveResult.result : null}
                size="default"
              />
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={publicEnabled}
              disabled={!isAdmin || busy}
              onChange={(event) => setPublicEnabled(event.target.checked)}
            />
            <span>
              <span className="block font-medium">Readable by all authenticated users</span>
              <span className="block text-xs text-muted-foreground">
                Toggle, then click Save Public Access to apply.
              </span>
            </span>
          </label>
        </section>
      </CardContent>
    </Card>
  );
}
