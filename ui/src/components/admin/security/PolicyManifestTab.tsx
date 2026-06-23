"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Eye, FileText, Loader2, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AuthorizationPolicyDefinition } from "@/lib/rbac/authorization-policy-catalog";

// assisted-by Codex Codex-sonnet-4-6

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

function plainSurface(surface: string): string {
  if (surface === "slack") return "Slack";
  if (surface === "webex") return "Webex";
  return humanize(surface);
}

function plainSubject(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  if (grant.subject.type === "team" && grant.subject.relation === "member") return "Team members";
  if (grant.subject.type === "team" && grant.subject.relation === "admin") return "Team admins";
  if (grant.subject.type === "team") return "The assigned team";
  return humanize(grant.subject.type);
}

function plainResource(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  if (grant.resource.type === "slack_channel") return "this Slack channel";
  if (grant.resource.type === "webex_space") return "this Webex space";
  return `this ${humanize(grant.resource.type).toLowerCase()}`;
}

function plainAction(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  if (grant.action === "manage") return "can change settings for";
  if (grant.action === "use") return "can use";
  if (grant.action === "read") return "can view";
  if (grant.action === "call" || grant.action === "invoke") return "can call";
  return `can ${humanize(grant.action).toLowerCase()}`;
}

function grantSentence(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  return `${plainSubject(grant)} ${plainAction(grant)} ${plainResource(grant)}.`;
}

function policyHeading(policy: AuthorizationPolicyDefinition): string {
  if (policy.id === "slack_channel_team_assignment_v1") return "When a Slack channel is assigned to a team";
  if (policy.id === "webex_space_team_assignment_v1") return "When a Webex space is assigned to a team";
  return policy.title;
}

function policyOutcome(policy: AuthorizationPolicyDefinition): string {
  if (policy.id === "slack_channel_team_assignment_v1") {
    return "The team can use the Slack integration, and team members can update bot routing for that channel.";
  }
  if (policy.id === "webex_space_team_assignment_v1") {
    return "The team can use the Webex integration, while team admins keep control of the space settings.";
  }
  return policy.description;
}

function featureName(policy: AuthorizationPolicyDefinition): string {
  return policy.feature?.name ?? `${plainSurface(policy.surface)} feature`;
}

function featureSummary(policy: AuthorizationPolicyDefinition): string {
  return policy.feature?.summary ?? policy.description;
}

function grantTemplate(grant: AuthorizationPolicyDefinition["grants"][number]): string {
  const subjectRelation = grant.subject.relation ? `#${grant.subject.relation}` : "";
  return `${grant.subject.type}:{${grant.subject.parameter}}${subjectRelation} ${grant.action} ${grant.resource.type}:{${grant.resource.parameter}}`;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function policyToYaml(policy: AuthorizationPolicyDefinition): string {
  const lines = [
    `id: ${yamlScalar(policy.id)}`,
    `family: ${yamlScalar(policy.family)}`,
    `surface: ${yamlScalar(policy.surface)}`,
    `title: ${yamlScalar(policy.title)}`,
    `description: ${yamlScalar(policy.description)}`,
    `trigger: ${yamlScalar(policy.trigger)}`,
    "feature:",
    `  name: ${yamlScalar(policy.feature.name)}`,
    `  summary: ${yamlScalar(policy.feature.summary)}`,
    "  subfeatures:",
    ...policy.feature.subfeatures.flatMap((subfeature) => [
      `    - name: ${yamlScalar(subfeature.name)}`,
      `      behavior: ${yamlScalar(subfeature.behavior)}`,
      `      authorization: ${yamlScalar(subfeature.authorization)}`,
    ]),
    "grants:",
    ...policy.grants.flatMap((grant) => [
      "  - subject:",
      `      type: ${yamlScalar(grant.subject.type)}`,
      `      parameter: ${yamlScalar(grant.subject.parameter)}`,
      ...(grant.subject.relation ? [`      relation: ${yamlScalar(grant.subject.relation)}`] : []),
      `    action: ${yamlScalar(grant.action)}`,
      "    resource:",
      `      type: ${yamlScalar(grant.resource.type)}`,
      `      parameter: ${yamlScalar(grant.resource.parameter)}`,
    ]),
  ];

  return `${lines.join("\n")}\n`;
}

function downloadPolicy(policy: AuthorizationPolicyDefinition, format: "json" | "yaml") {
  const content = format === "json" ? `${JSON.stringify(policy, null, 2)}\n` : policyToYaml(policy);
  const blob = new Blob([content], {
    type: format === "json" ? "application/json" : "application/yaml",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${policy.id}.${format === "json" ? "json" : "yaml"}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function policyMatches(policy: AuthorizationPolicyDefinition, query: string): boolean {
  const haystack = [
    policy.id,
    policy.family,
    policy.surface,
    policy.title,
    policy.description,
    policy.trigger,
    policyHeading(policy),
    policyOutcome(policy),
    policy.feature?.name ?? "",
    policy.feature?.summary ?? "",
    ...(policy.feature?.subfeatures.flatMap((subfeature) => [
      subfeature.name,
      subfeature.behavior,
      subfeature.authorization,
    ]) ?? []),
    ...policy.grants.flatMap((grant) => [
      grantSentence(grant),
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
  const [selectedPolicy, setSelectedPolicy] = useState<AuthorizationPolicyDefinition | null>(null);

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
            Sharing Rules
          </CardTitle>
          <CardDescription>
            See what access people get when an admin shares a Slack channel, Webex space, or other resource with a team.
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
              placeholder="Search sharing rules"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Product
            <select
              aria-label="Product"
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
            Rule type
            <select
              aria-label="Rule type"
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
              {filteredPolicies.length} of {policies.length} sharing rule{policies.length === 1 ? "" : "s"} shown
            </div>
            {filteredPolicies.map((policy) => (
              <section key={policy.id} className="rounded-md border p-4" data-testid={`policy-manifest-${policy.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{policyHeading(policy)}</h3>
                      <Badge variant="outline">{plainSurface(policy.surface)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{policyOutcome(policy)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => setSelectedPolicy(policy)}
                    >
                      <Eye className="h-4 w-4" />
                      View manifest
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => downloadPolicy(policy, "yaml")}
                    >
                      <Download className="h-4 w-4" />
                      YAML
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => downloadPolicy(policy, "json")}
                    >
                      <Download className="h-4 w-4" />
                      JSON
                    </Button>
                    <Badge variant="secondary">{policy.grants.length} access changes</Badge>
                  </div>
                </div>

                <div className="mt-4 rounded-md border bg-background/50 p-3">
                  <div className="text-xs font-medium uppercase text-muted-foreground">Feature</div>
                  <div className="mt-1 text-sm font-medium">{featureName(policy)}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{featureSummary(policy)}</p>
                  {policy.feature?.subfeatures.length ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {policy.feature.subfeatures.map((subfeature) => (
                        <div key={`${policy.id}-${subfeature.name}`} className="rounded-md bg-muted/30 p-3">
                          <div className="text-sm font-medium">{subfeature.name}</div>
                          <p className="mt-1 text-xs text-muted-foreground">{subfeature.behavior}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">Authorization:</span>{" "}
                            {subfeature.authorization}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 rounded-md bg-muted/30 p-3">
                  <div className="text-xs font-medium uppercase text-muted-foreground">What happens</div>
                  <ul className="mt-2 space-y-2 text-sm">
                    {policy.grants.map((grant, index) => (
                      <li key={`${policy.id}-summary-${index}`} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{grantSentence(grant)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    This happens automatically when {policy.trigger}.
                  </p>
                </div>

                <details className="mt-3 rounded-md border bg-background/60 p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground">Show technical mapping</summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <span className="text-muted-foreground">Policy ID:</span>{" "}
                      <code>{policy.id}</code>
                    </div>
                    <div className="space-y-2">
                  {policy.grants.map((grant, index) => (
                    <div
                      key={`${policy.id}-template-${index}`}
                      className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm md:grid-cols-[1fr_auto_1fr]"
                    >
                      <div>
                        <div className="text-xs text-muted-foreground">Who</div>
                        <div className="font-medium">
                          {grant.subject.type}:{`{${grant.subject.parameter}}`}
                          {grant.subject.relation ? `#${grant.subject.relation}` : ""}
                        </div>
                      </div>
                      <div className="font-medium text-primary">
                        {grant.action}
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">What</div>
                        <div className="font-medium">
                          {grant.resource.type}:{`{${grant.resource.parameter}}`}
                        </div>
                      </div>
                    </div>
                  ))}
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
      <PolicyManifestDialog policy={selectedPolicy} onOpenChange={(open) => !open && setSelectedPolicy(null)} />
    </Card>
  );
}

function PolicyManifestDialog({
  policy,
  onOpenChange,
}: {
  policy: AuthorizationPolicyDefinition | null;
  onOpenChange: (open: boolean) => void;
}) {
  const json = useMemo(() => (policy ? `${JSON.stringify(policy, null, 2)}\n` : ""), [policy]);
  const yaml = useMemo(() => (policy ? policyToYaml(policy) : ""), [policy]);

  return (
    <Dialog open={Boolean(policy)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle>Policy manifest</DialogTitle>
          <DialogDescription>{policy ? policyHeading(policy) : "Policy manifest"}</DialogDescription>
        </DialogHeader>
        {policy ? (
          <Tabs defaultValue="yaml" className="flex min-h-0 flex-col px-6 pb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <TabsList>
                <TabsTrigger value="yaml">YAML</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadPolicy(policy, "yaml")}>
                  <Download className="h-4 w-4" />
                  Download YAML
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadPolicy(policy, "json")}>
                  <Download className="h-4 w-4" />
                  Download JSON
                </Button>
              </div>
            </div>
            <TabsContent value="yaml" className="mt-0 min-h-0">
              <pre className="max-h-[55vh] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-relaxed">
                <code>{yaml}</code>
              </pre>
            </TabsContent>
            <TabsContent value="json" className="mt-0 min-h-0">
              <pre className="max-h-[55vh] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-relaxed">
                <code>{json}</code>
              </pre>
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
