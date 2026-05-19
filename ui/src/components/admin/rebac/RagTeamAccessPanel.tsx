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

interface CatalogResponse {
  teams: CatalogTeam[];
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

export function RagTeamAccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const [teams, setTeams] = useState<CatalogTeam[]>([]);
  const [teamAccessTeamId, setTeamAccessTeamId] = useState("");
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
    setTeams(data.teams ?? []);
    setTeamAccessTeamId((prev) => prev || data.teams?.[0]?.id || "");
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
