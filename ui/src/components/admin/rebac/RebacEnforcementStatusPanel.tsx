"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UniversalRebacResourceAction, UniversalRebacResourceType } from "@/types/rbac-universal";

interface EnforcementStatusRow {
  resource_type: UniversalRebacResourceType;
  enforcement_status: "not_gated" | "role_gated" | "rebac_shadowed" | "rebac_enforced" | "deprecated";
  surface: string;
  notes?: string;
}

interface ComparisonResult {
  enforcement_status: EnforcementStatusRow["enforcement_status"];
  legacy: { allowed: boolean; matched_roles: string[]; ignored_roles: string[] };
  rebac: { allowed: boolean };
  effective: { allowed: boolean; source: "legacy_role" | "rebac" };
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

export function RebacEnforcementStatusPanel() {
  const [statuses, setStatuses] = useState<EnforcementStatusRow[]>([]);
  const [resourceType, setResourceType] = useState("agent");
  const [resourceId, setResourceId] = useState("platform-engineer");
  const [subjectId, setSubjectId] = useState("alice_admin");
  const [action, setAction] = useState<UniversalRebacResourceAction>("use");
  const [roles, setRoles] = useState("agent_user:platform-engineer");
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/rebac/enforcement-status")
      .then((response) => response.json())
      .then((payload) => setStatuses(apiData<{ statuses: EnforcementStatusRow[] }>(payload).statuses))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load status"));
  }, []);

  async function compare() {
    setError(null);
    setComparison(null);
    const response = await fetch("/api/rbac/enforcement-comparison", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: { type: "user", id: subjectId },
        resource: { type: resourceType, id: resourceId },
        action,
        realm_roles: roles.split(",").map((role) => role.trim()).filter(Boolean),
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      setError(payload.error ?? "Comparison failed");
      return;
    }
    setComparison(apiData<ComparisonResult>(payload));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader>
          <CardTitle>ReBAC Enforcement Status</CardTitle>
          <CardDescription>
            Resource types marked ReBAC-enforced no longer treat stale Keycloak resource roles as allow decisions.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {statuses.map((row) => (
            <div key={row.resource_type} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-mono text-sm">{row.resource_type}</div>
                <div className="text-xs text-muted-foreground">{row.notes ?? row.surface}</div>
              </div>
              <Badge variant={row.enforcement_status === "rebac_enforced" ? "default" : "secondary"}>
                {row.enforcement_status}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role vs ReBAC Compare</CardTitle>
          <CardDescription>Preview which decision source wins during migration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="rebac-subject">User subject</Label>
            <Input id="rebac-subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="rebac-resource-type">Resource type</Label>
              <Input id="rebac-resource-type" value={resourceType} onChange={(event) => setResourceType(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rebac-action">Action</Label>
              <Input id="rebac-action" value={action} onChange={(event) => setAction(event.target.value as UniversalRebacResourceAction)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rebac-resource-id">Resource id</Label>
            <Input id="rebac-resource-id" value={resourceId} onChange={(event) => setResourceId(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rebac-roles">Realm roles (comma-separated)</Label>
            <Input id="rebac-roles" value={roles} onChange={(event) => setRoles(event.target.value)} />
          </div>
          <Button type="button" onClick={compare}>Compare</Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {comparison && (
            <div className="rounded-md border p-3 text-sm">
              <div>Effective: {comparison.effective.allowed ? "Allow" : "Deny"} via {comparison.effective.source}</div>
              <div>Legacy roles: {comparison.legacy.allowed ? "allow" : "deny"}</div>
              <div>ReBAC: {comparison.rebac.allowed ? "allow" : "deny"}</div>
              {comparison.legacy.ignored_roles.length > 0 && (
                <div className="text-muted-foreground">
                  Ignored stale roles: {comparison.legacy.ignored_roles.join(", ")}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
