"use client";

import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { cn } from "@/lib/utils";
import { KeyRound,Layers,Loader2,RefreshCw,Shield,Users } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

interface RbacPosture {
  email?: string;
  idp_source: string;
  legacy_resource_roles_hidden_count?: number;
  name?: string;
  per_agent_roles: string[];
  per_kb_roles: string[];
  realm_roles: string[];
  role: string;
  slack_linked: boolean;
  teams: Array<{ _id: string;name: string;role?: string;slug?: string }>;
}

export function AccessSettings(): React.ReactElement {
  const [posture,setPosture] = useState<RbacPosture | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/my-roles");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load your access");
      setPosture(data as RbacPosture);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your access");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading your access…
      </div>
    );
  }

  if (error || !posture) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <p>{error || "Your access information is unavailable."}</p>
        <Button className="mt-3 gap-2" onClick={() => void load()} size="sm" variant="outline">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        description="This information comes from your identity provider and platform access policy."
        title={<span className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" />Identity and role</span>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform role</p>
            <span
              className={cn(
                "mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
                posture.role === "admin"
                  ? "border-primary/30 bg-primary/15 text-primary"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {posture.role === "admin" ? "Platform admin" : "User"}
            </span>
          </div>
          <div className="rounded-lg border border-border/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connected identity</p>
            <p className="mt-2 text-sm font-medium">{posture.name || posture.email || "Signed-in user"}</p>
            {posture.email ? <p className="text-xs text-muted-foreground">{posture.email}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Slack account: {posture.slack_linked ? "Linked" : "Not linked"}
            </p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        description="Teams determine which shared agents, skills, tools, and knowledge bases you can use."
        title={<span className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" />Teams ({posture.teams.length})</span>}
      >
        {posture.teams.length ? (
          <div className="divide-y divide-border rounded-lg border border-border/70">
            {posture.teams.map((team) => (
              <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2" key={team.slug || team._id}>
                <span className="text-sm font-medium">{team.name}</span>
                {team.role ? (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {team.role}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">You are not currently a member of a team.</p>
        )}
      </SettingsCard>

      <SettingsCard
        description="Technical identity details can help an administrator troubleshoot unexpected access."
        title={<span className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Technical access details</span>}
      >
        <details className="rounded-lg border border-border/70 p-4">
          <summary className="cursor-pointer text-sm font-medium">Show identity-provider details</summary>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Identity provider</dt>
              <dd className="break-all font-mono text-xs">{posture.idp_source}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Realm roles</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {posture.realm_roles.length ? posture.realm_roles.map((role) => (
                  <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary" key={role}>
                    {role}
                  </span>
                )) : <span className="text-xs text-muted-foreground">None</span>}
              </dd>
            </div>
            {posture.legacy_resource_roles_hidden_count ? (
              <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {posture.legacy_resource_roles_hidden_count} legacy resource role(s) are hidden because current access is evaluated by policy.
              </div>
            ) : null}
          </dl>
        </details>
      </SettingsCard>
    </div>
  );
}
