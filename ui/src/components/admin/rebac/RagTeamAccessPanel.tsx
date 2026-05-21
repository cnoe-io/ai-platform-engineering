"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

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

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

export function RagTeamAccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const [teams, setTeams] = useState<CatalogTeam[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<CatalogKnowledgeBase[]>([]);
  const [teamAccessTeamId, setTeamAccessTeamId] = useState("");
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<KbPermission>("read");
  const [ragAdminEnabled, setRagAdminEnabled] = useState(false);
  const [teamAccessLoading, setTeamAccessLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedTeam = teams.find((team) => team.id === teamAccessTeamId);
  const teamAccessSlug = selectedTeam?.slug ?? teamAccessTeamId;

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
  }, []);

  const loadTeamAccess = useCallback(async () => {
    if (!teamAccessTeamId) return;
    setTeamAccessLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        user: `team:${teamAccessSlug}#member`,
        relation: "manager",
        object: "admin_surface:rag_datasources",
        limit: "1",
      });
      const res = await fetch(`/api/admin/openfga/tuples?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load RAG team access: ${res.status}`);
      const payload = await res.json();
      const data = apiData<{ tuples: unknown[] }>(payload);
      setRagAdminEnabled((data.tuples ?? []).length > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load RAG team access");
    } finally {
      setTeamAccessLoading(false);
    }
  }, [teamAccessSlug, teamAccessTeamId]);

  useEffect(() => {
    void loadCatalog().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load RAG team access catalog");
    });
  }, [loadCatalog]);

  useEffect(() => {
    void loadTeamAccess();
  }, [loadTeamAccess]);

  async function saveTeamAccess() {
    if (!teamAccessTeamId || !isAdmin) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/openfga/relationship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlug: teamAccessSlug,
          resourceType: "admin_surface",
          resourceId: "rag_datasources",
          relation: "manager",
          operation: ragAdminEnabled ? "grant" : "revoke",
        }),
      });
      if (!res.ok) throw new Error(`Failed to save RAG team access: ${res.status}`);
      setMessage("RAG team access saved to OpenFGA");
      await loadTeamAccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "RAG team access save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveKnowledgeBaseAccess() {
    if (!teamAccessTeamId || !selectedKnowledgeBaseId || !isAdmin) return;
    setBusy(true);
    setError(null);
    setMessage(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Knowledge Base access save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>RAG Team Access</CardTitle>
        <CardDescription>
          Grant explicit RAG admin access to the Data Sources surface. Individual Knowledge Base
          datasource grants stay in the Data Sources team access UI and remain deny-by-default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}

        <div className="grid gap-2 md:max-w-sm">
          <Label htmlFor="rag-team-access-team">Team</Label>
          <select
            id="rag-team-access-team"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={teamAccessTeamId}
            disabled={!isAdmin || teamAccessLoading}
            onChange={(event) => setTeamAccessTeamId(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name || team.slug}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border p-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={ragAdminEnabled}
              disabled={!isAdmin || teamAccessLoading}
              onChange={(event) => setRagAdminEnabled(event.target.checked)}
            />
            <span>
              <span className="block font-medium">Data Sources admin</span>
              <span className="block text-xs text-muted-foreground">
                Writes{" "}
                <code className="rounded bg-muted px-1">
                  team:&lt;slug&gt;#member manager admin_surface:rag_datasources
                </code>
                . Teams without this grant cannot administer the Data Sources tab. Readonly access
                comes from explicit per-datasource grants.
              </span>
            </span>
          </label>
        </div>

        <div className="rounded-md border p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Knowledge Base access</p>
            <p className="text-xs text-muted-foreground">
              Baseline RAG service access comes from organization membership. These grants control
              which team members can read, ingest, or administer specific Knowledge Bases.
            </p>
          </div>
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
              <Button
                onClick={saveKnowledgeBaseAccess}
                disabled={!isAdmin || busy || !teamAccessTeamId || !selectedKnowledgeBaseId}
              >
                Grant KB Access
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={loadTeamAccess}
            disabled={!teamAccessTeamId || teamAccessLoading}
          >
            {teamAccessLoading ? "Refreshing..." : "Refresh Team Access"}
          </Button>
          <Button
            onClick={saveTeamAccess}
            disabled={!isAdmin || busy || teamAccessLoading || !teamAccessTeamId}
          >
            Save RAG Team Access
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
