"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, GitBranch, Loader2, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AuthorizationPolicyDefinition } from "@/lib/rbac/authorization-policy-catalog";

interface PolicyCatalogResponse {
  policies: AuthorizationPolicyDefinition[];
  count: number;
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function subjectLabel(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  const relation = grant.subject.relation ? ` ${grant.subject.relation}` : "";
  return `${humanize(grant.subject.type)} ${grant.subject.parameter}${relation}`;
}

function resourceLabel(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  return `${humanize(grant.resource.type)} ${grant.resource.parameter}`;
}

function grantTemplate(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  const subjectRelation = grant.subject.relation ? `#${grant.subject.relation}` : "";
  return `${grant.subject.type}:{${grant.subject.parameter}}${subjectRelation} ${grant.action} ${grant.resource.type}:{${grant.resource.parameter}}`;
}

function policyMatches(policy: AuthorizationPolicyDefinition, query: string): boolean {
  const haystack = [
    policy.id,
    policy.family,
    policy.surface,
    policy.title,
    policy.description,
    policy.trigger,
    ...policy.grants.flatMap((grant) => [
      grant.subject.type,
      grant.subject.parameter,
      grant.subject.relation ?? "",
      grant.action,
      grant.resource.type,
      grant.resource.parameter,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function PolicyManifestTab() {
  const [policies, setPolicies] = useState<AuthorizationPolicyDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState("all");
  const [family, setFamily] = useState("all");
  const [query, setQuery] = useState("");

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/rebac/policies/catalog");
      if (!response.ok) throw new Error(`Failed to load policy manifest: ${response.status}`);
      const payload = await response.json();
      setPolicies(apiData<PolicyCatalogResponse>(payload).policies ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policy manifest");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  const surfaces = useMemo(
    () => ["all", ...Array.from(new Set(policies.map((policy) => policy.surface))).sort()],
    [policies]
  );
  const families = useMemo(
    () => ["all", ...Array.from(new Set(policies.map((policy) => policy.family))).sort()],
    [policies]
  );
  const filteredPolicies = useMemo(
    () =>
      policies.filter(
        (policy) =>
          (surface === "all" || policy.surface === surface) &&
          (family === "all" || policy.family === family) &&
          (!query.trim() || policyMatches(policy, query.trim()))
      ),
    [family, policies, query, surface]
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Policy Manifest
          </CardTitle>
          <CardDescription>
            Review the reusable authorization rules that product flows apply when teams share resources.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="gap-2 self-start" onClick={loadPolicies}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search policy manifest"
              className="pl-9"
              placeholder="Search policies, actions, or resources"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Surface
            <select
              aria-label="Policy surface"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={surface}
              onChange={(event) => setSurface(event.target.value)}
            >
              {surfaces.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All surfaces" : humanize(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Policy family
            <select
              aria-label="Policy family"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={family}
              onChange={(event) => setFamily(event.target.value)}
            >
              {families.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All families" : humanize(option)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading && (
          <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading policy manifest...
          </div>
        )}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {!loading && !error && (
          <div className="space-y-3" data-testid="policy-manifest-list">
            <div className="text-sm text-muted-foreground">
              {filteredPolicies.length} of {policies.length} polic{policies.length === 1 ? "y" : "ies"} shown
            </div>
            {filteredPolicies.map((policy) => (
              <section key={policy.id} className="rounded-md border p-4" data-testid={`policy-manifest-${policy.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{policy.title}</h3>
                      <Badge variant="outline">{humanize(policy.surface)}</Badge>
                      <Badge variant="secondary">{humanize(policy.family)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{policy.description}</p>
                    <p className="text-xs text-muted-foreground">Runs when {policy.trigger}.</p>
                  </div>
                  <Badge variant="outline">{policy.grants.length} grants</Badge>
                </div>

                <div className="mt-4 space-y-2">
                  {policy.grants.map((grant, index) => (
                    <div
                      key={`${policy.id}-${index}`}
                      className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm md:grid-cols-[1fr_auto_1fr]"
                    >
                      <div>
                        <div className="text-xs text-muted-foreground">Who</div>
                        <div className="font-medium">{subjectLabel(grant)}</div>
                      </div>
                      <div className="flex items-center gap-2 font-medium text-primary">
                        <GitBranch className="h-4 w-4" />
                        {humanize(grant.action)}
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">What</div>
                        <div className="font-medium">{resourceLabel(grant)}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <details className="mt-3 rounded-md border bg-background/60 p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground">Technical details</summary>
                  <div className="mt-3 space-y-2">
                    <div>
                      <span className="text-muted-foreground">Policy ID:</span>{" "}
                      <code>{policy.id}</code>
                    </div>
                    <div className="space-y-1">
                      {policy.grants.map((grant, index) => (
                        <code key={`${policy.id}-template-${index}`} className="block whitespace-pre-wrap">
                          {grantTemplate(grant)}
                        </code>
                      ))}
                    </div>
                  </div>
                </details>
              </section>
            ))}
            {filteredPolicies.length === 0 && (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No policies match the current filters.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
