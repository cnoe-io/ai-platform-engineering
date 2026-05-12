"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Loader2,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ResourceType = "agent" | "tool" | "knowledge_base";

interface CatalogTeam {
  id: string;
  slug: string;
  name: string;
  members: Array<{ user_id: string; role: string }>;
  resources: Record<string, unknown>;
}

interface CatalogResource {
  id: string;
  name: string;
  description: string;
  object: string;
}

interface CatalogResponse {
  status: {
    configured: boolean;
    reconcile_enabled: boolean;
    store_name: string;
  };
  teams: CatalogTeam[];
  resources: {
    agents: CatalogResource[];
    tools: CatalogResource[];
    knowledge_bases: CatalogResource[];
  };
}

interface TupleKey {
  user: string;
  relation: string;
  object: string;
}

interface TupleRecord {
  key: TupleKey;
  timestamp?: string;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
}

const RELATIONS_BY_TYPE: Record<ResourceType, string[]> = {
  agent: ["can_use", "can_manage"],
  tool: ["can_call"],
  knowledge_base: ["can_read", "can_ingest", "can_admin"],
};

const RESOURCE_LABELS: Record<ResourceType, string> = {
  agent: "Agent",
  tool: "Tool",
  knowledge_base: "Knowledge base",
};

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function typeResources(catalog: CatalogResponse | null, type: ResourceType): CatalogResource[] {
  if (!catalog) return [];
  if (type === "agent") return catalog.resources.agents;
  if (type === "tool") return catalog.resources.tools;
  return catalog.resources.knowledge_bases;
}

function statusBadge(catalog: CatalogResponse | null) {
  if (!catalog?.status.configured) {
    return <Badge variant="destructive">OpenFGA not configured</Badge>;
  }
  if (!catalog.status.reconcile_enabled) {
    return <Badge variant="secondary">Tuple writes available, team-save reconciliation disabled</Badge>;
  }
  return <Badge variant="default">OpenFGA reconciliation enabled</Badge>;
}

export function OpenFgaRebacTab({ isAdmin }: { isAdmin: boolean }) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [tuples, setTuples] = useState<TupleRecord[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [teamSlug, setTeamSlug] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>("agent");
  const [resourceId, setResourceId] = useState("");
  const [relation, setRelation] = useState("can_use");
  const [checkResult, setCheckResult] = useState<boolean | null>(null);
  const [tupleFilter, setTupleFilter] = useState<Partial<TupleKey>>({});

  const resources = useMemo(() => typeResources(catalog, resourceType), [catalog, resourceType]);
  const selectedTuple: TupleKey | null = useMemo(() => {
    if (!teamSlug || !resourceId || !relation) return null;
    return {
      user: `team:${teamSlug}#member`,
      relation,
      object: `${resourceType}:${resourceId}`,
    };
  }, [relation, resourceId, resourceType, teamSlug]);

  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/admin/openfga/catalog");
    if (!res.ok) throw new Error(`Failed to load catalog: ${res.status}`);
    const payload = await res.json();
    const data = apiData<CatalogResponse>(payload);
    setCatalog(data);
    setTeamSlug((prev) => prev || data.teams[0]?.slug || "");
    setResourceId((prev) => prev || data.resources.agents[0]?.id || "");
  }, []);

  const loadTuples = useCallback(async () => {
    const params = new URLSearchParams();
    if (tupleFilter.user) params.set("user", tupleFilter.user);
    if (tupleFilter.relation) params.set("relation", tupleFilter.relation);
    if (tupleFilter.object) params.set("object", tupleFilter.object);
    params.set("limit", "100");
    const res = await fetch(`/api/admin/openfga/tuples?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to load tuples: ${res.status}`);
    const payload = await res.json();
    setTuples(apiData<{ tuples: TupleRecord[] }>(payload).tuples ?? []);
  }, [tupleFilter]);

  const loadGraph = useCallback(async () => {
    const params = new URLSearchParams();
    if (teamSlug) params.set("team", teamSlug);
    const res = await fetch(`/api/admin/openfga/graph?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to load graph: ${res.status}`);
    const payload = await res.json();
    setGraph(apiData<{ nodes: GraphNode[]; edges: GraphEdge[] }>(payload));
  }, [teamSlug]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadCatalog();
      await loadTuples();
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load OpenFGA data");
    } finally {
      setLoading(false);
    }
  }, [loadCatalog, loadGraph, loadTuples]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const nextRelation = RELATIONS_BY_TYPE[resourceType][0];
    setRelation(nextRelation);
    setResourceId(typeResources(catalog, resourceType)[0]?.id || "");
  }, [catalog, resourceType]);

  async function mutateRelationship(operation: "grant" | "revoke") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/openfga/relationship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug, resourceType, resourceId, relation, operation }),
      });
      if (!res.ok) throw new Error(`OpenFGA ${operation} failed: ${res.status}`);
      setMessage(`${operation === "grant" ? "Granted" : "Revoked"} ${relation} on ${resourceType}:${resourceId}`);
      await Promise.all([loadTuples(), loadGraph()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OpenFGA relationship update failed");
    } finally {
      setBusy(false);
    }
  }

  async function checkAccess() {
    if (!selectedTuple) return;
    setBusy(true);
    setError(null);
    setCheckResult(null);
    try {
      const res = await fetch("/api/admin/openfga/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tuple: selectedTuple }),
      });
      if (!res.ok) throw new Error(`OpenFGA check failed: ${res.status}`);
      const payload = await res.json();
      setCheckResult(Boolean(apiData<{ allowed: boolean }>(payload).allowed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "OpenFGA check failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTuple(tuple: TupleKey) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/openfga/tuples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletes: [tuple] }),
      });
      if (!res.ok) throw new Error(`Tuple delete failed: ${res.status}`);
      setMessage(`Deleted ${tuple.user} ${tuple.relation} ${tuple.object}`);
      await Promise.all([loadTuples(), loadGraph()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tuple delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading OpenFGA ReBAC admin data...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">OpenFGA ReBAC</h2>
          <p className="text-sm text-muted-foreground">
            Author and inspect team-to-resource relationships enforced by AgentGateway ext_authz.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(catalog)}
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          {error}
        </div>
      )}
      {message && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4" />
          {message}
        </div>
      )}

      <Tabs defaultValue="builder" className="space-y-4">
        <TabsList>
          <TabsTrigger value="builder">Relationship Builder</TabsTrigger>
          <TabsTrigger value="explorer">Effective Access</TabsTrigger>
          <TabsTrigger value="graph">Policy Graph</TabsTrigger>
          <TabsTrigger value="tuples">Tuple Inspector</TabsTrigger>
        </TabsList>

        <TabsContent value="builder">
          <Card>
            <CardHeader>
              <CardTitle>Grant Team Access</CardTitle>
              <CardDescription>
                Create OpenFGA tuples from known teams and resources instead of typing raw relationships.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RelationshipForm
                catalog={catalog}
                teamSlug={teamSlug}
                resourceType={resourceType}
                resourceId={resourceId}
                relation={relation}
                resources={resources}
                onTeamSlug={setTeamSlug}
                onResourceType={setResourceType}
                onResourceId={setResourceId}
                onRelation={setRelation}
              />
              {selectedTuple && <TuplePreview tuple={selectedTuple} />}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!isAdmin || busy || !selectedTuple} onClick={() => mutateRelationship("grant")}>
                  Grant relationship
                </Button>
                <Button
                  variant="outline"
                  disabled={!isAdmin || busy || !selectedTuple}
                  onClick={() => mutateRelationship("revoke")}
                >
                  Revoke relationship
                </Button>
              </div>
              {!isAdmin && <p className="text-sm text-muted-foreground">You can inspect ReBAC, but only admins can mutate tuples.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="explorer">
          <Card>
            <CardHeader>
              <CardTitle>Effective Access Preview</CardTitle>
              <CardDescription>
                Run OpenFGA Check for the selected team relation before testing through AgentGateway.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RelationshipForm
                catalog={catalog}
                teamSlug={teamSlug}
                resourceType={resourceType}
                resourceId={resourceId}
                relation={relation}
                resources={resources}
                onTeamSlug={setTeamSlug}
                onResourceType={setResourceType}
                onResourceId={setResourceId}
                onRelation={setRelation}
              />
              {selectedTuple && <TuplePreview tuple={selectedTuple} />}
              <Button disabled={busy || !selectedTuple} onClick={checkAccess} className="gap-2">
                <Shield className="h-4 w-4" />
                Check effective access
              </Button>
              {checkResult !== null && (
                <div className="rounded-md border p-3 text-sm">
                  Result:{" "}
                  <Badge variant={checkResult ? "default" : "destructive"}>
                    {checkResult ? "allowed" : "denied"}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="graph">
          <Card>
            <CardHeader>
              <CardTitle>Policy / Resource Graph</CardTitle>
              <CardDescription>
                Visualizes OpenFGA usersets as edges. The selected team filters the graph to team membership and resource grants.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div>
                  <Label htmlFor="graph-team">Team</Label>
                  <select
                    id="graph-team"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={teamSlug}
                    onChange={(event) => setTeamSlug(event.target.value)}
                  >
                    {catalog?.teams.map((team) => (
                      <option key={team.slug} value={team.slug}>
                        {team.name} ({team.slug})
                      </option>
                    ))}
                  </select>
                </div>
                <Button variant="outline" className="self-end gap-2" onClick={loadGraph}>
                  <GitBranch className="h-4 w-4" />
                  Render graph
                </Button>
              </div>
              <GraphSummary graph={graph} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tuples">
          <Card>
            <CardHeader>
              <CardTitle>Tuple Inspector</CardTitle>
              <CardDescription>
                Advanced view of materialized OpenFGA tuples. Filters are passed through the BFF and capped to 100 rows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <FilterInput label="User" value={tupleFilter.user ?? ""} onChange={(user) => setTupleFilter((prev) => ({ ...prev, user }))} />
                <FilterInput label="Relation" value={tupleFilter.relation ?? ""} onChange={(relationValue) => setTupleFilter((prev) => ({ ...prev, relation: relationValue }))} />
                <FilterInput label="Object" value={tupleFilter.object ?? ""} onChange={(object) => setTupleFilter((prev) => ({ ...prev, object }))} />
                <Button variant="outline" className="self-end" onClick={loadTuples}>
                  Apply filters
                </Button>
              </div>
              <div className="space-y-2">
                {tuples.length === 0 ? (
                  <p className="rounded-md border p-4 text-sm text-muted-foreground">No tuples found for the current filter.</p>
                ) : (
                  tuples.map((tuple) => (
                    <div key={`${tuple.key.user}:${tuple.key.relation}:${tuple.key.object}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                      <code className="break-all">
                        {tuple.key.user} <span className="text-muted-foreground">{tuple.key.relation}</span> {tuple.key.object}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isAdmin || busy}
                        onClick={() => deleteTuple(tuple.key)}
                        className="gap-1 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RelationshipForm(props: {
  catalog: CatalogResponse | null;
  teamSlug: string;
  resourceType: ResourceType;
  resourceId: string;
  relation: string;
  resources: CatalogResource[];
  onTeamSlug: (value: string) => void;
  onResourceType: (value: ResourceType) => void;
  onResourceId: (value: string) => void;
  onRelation: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <div>
        <Label htmlFor="rebac-team">Team</Label>
        <select
          id="rebac-team"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={props.teamSlug}
          onChange={(event) => props.onTeamSlug(event.target.value)}
        >
          {props.catalog?.teams.map((team) => (
            <option key={team.slug} value={team.slug}>
              {team.name} ({team.slug})
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="rebac-resource-type">Resource type</Label>
        <select
          id="rebac-resource-type"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={props.resourceType}
          onChange={(event) => props.onResourceType(event.target.value as ResourceType)}
        >
          {Object.entries(RESOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="rebac-resource">Resource</Label>
        <select
          id="rebac-resource"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={props.resourceId}
          onChange={(event) => props.onResourceId(event.target.value)}
        >
          {props.resources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="rebac-relation">Relation</Label>
        <select
          id="rebac-relation"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={props.relation}
          onChange={(event) => props.onRelation(event.target.value)}
        >
          {RELATIONS_BY_TYPE[props.resourceType].map((rel) => (
            <option key={rel} value={rel}>
              {rel}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TuplePreview({ tuple }: { tuple: TupleKey }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="font-medium">Tuple preview</div>
      <code className="mt-1 block break-all">
        {tuple.user} <span className="text-muted-foreground">{tuple.relation}</span> {tuple.object}
      </code>
    </div>
  );
}

function FilterInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" value={value} onChange={(event) => onChange(event.target.value)} placeholder={`${label.toLowerCase()} filter`} />
    </div>
  );
}

function GraphSummary({ graph }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }) {
  const grouped = graph.edges.reduce<Record<string, GraphEdge[]>>((acc, edge) => {
    acc[edge.relation] = [...(acc[edge.relation] ?? []), edge];
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Nodes" value={graph.nodes.length} />
        <MetricCard label="Relationships" value={graph.edges.length} />
        <MetricCard label="Relation types" value={Object.keys(grouped).length} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-medium">Nodes</div>
          <div className="flex flex-wrap gap-2">
            {graph.nodes.length === 0 ? (
              <span className="text-sm text-muted-foreground">No graph nodes loaded.</span>
            ) : (
              graph.nodes.map((node) => (
                <Badge key={node.id} variant="secondary">
                  {node.label}
                </Badge>
              ))
            )}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-medium">Edges</div>
          <div className="space-y-2">
            {graph.edges.length === 0 ? (
              <span className="text-sm text-muted-foreground">No graph edges loaded.</span>
            ) : (
              graph.edges.map((edge) => (
                <div key={edge.id} className="rounded bg-muted/40 p-2 text-xs">
                  <code>{edge.from}</code> <span className="text-muted-foreground">{edge.relation}</span>{" "}
                  <code>{edge.to}</code>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
