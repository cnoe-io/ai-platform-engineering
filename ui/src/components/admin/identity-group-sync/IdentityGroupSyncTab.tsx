"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

import { DryRunPreview } from "./DryRunPreview";
import { MappingClusterEditor } from "./MappingClusterEditor";

interface IdentityGroupSyncTabProps {
  isAdmin: boolean;
}

export function IdentityGroupSyncTab({ isAdmin }: IdentityGroupSyncTabProps) {
  const [providerCount, setProviderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("Engineering Platform Users");
  const [userEmail, setUserEmail] = useState("bob@example.test");
  const [dryRun, setDryRun] = useState<IdentityGroupSyncDryRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/providers");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load providers");
      setProviderCount(json.data?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load identity providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const runDryRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: [
            {
              provider_id: "oidc-claims",
              external_group_id: groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              display_name: groupName,
              normalized_name: groupName.toLowerCase(),
              status: "active",
              members: [
                {
                  subject: userEmail ? userEmail.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : undefined,
                  email: userEmail,
                  display_name: userEmail,
                  active: true,
                },
              ],
            },
          ],
          rules: [
            {
              id: "preview-platform-users",
              provider_id: "oidc-claims",
              name: "Preview platform users",
              priority: 10,
              enabled: true,
              review_status: "enabled",
              include_patterns: ["^Engineering (?<team>Platform) (?<role>Users)$"],
              exclude_patterns: [],
              team_name_template: "{{team}}",
              team_slug_template: "{{team}}",
              role_map: { Users: "member" },
              auto_create_team: true,
              created_by: "ui",
              created_at: new Date().toISOString(),
              updated_by: "ui",
              updated_at: new Date().toISOString(),
            },
          ],
          existing_teams: [],
          existing_membership_sources: [],
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Dry-run failed");
      setDryRun(json.data?.dry_run ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dry-run failed");
    } finally {
      setRunning(false);
    }
  };

  const applyDryRun = async () => {
    if (!dryRun) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: true, dry_run: dryRun }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Apply failed");
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Identity Group Sync</CardTitle>
          <CardDescription>
            Preview and apply enterprise group mappings into CAIPE teams with membership-source provenance.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            {loading ? "Loading providers..." : `${providerCount} provider(s) configured`}
          </div>
          <Button variant="outline" size="sm" onClick={loadProviders} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </CardContent>
      </Card>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}

      <MappingClusterEditor
        groupName={groupName}
        setGroupName={setGroupName}
        userEmail={userEmail}
        setUserEmail={setUserEmail}
        onDryRun={runDryRun}
        disabled={!isAdmin || running}
      />

      <DryRunPreview result={dryRun} applying={applying} onApply={applyDryRun} />
    </div>
  );
}
