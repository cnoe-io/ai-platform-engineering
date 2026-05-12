"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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

const RESOURCE_TYPES = new Set<ResourceType>(["agent", "tool", "knowledge_base"]);
const ALL_RELATIONSHIPS_SCOPE = "__all_relationships__";

interface RebacNodeData {
  label: string;
  kind: string;
  object: string;
  description?: string;
  [key: string]: unknown;
}

interface RebacEdgeData {
  tuple: TupleKey;
  staged?: "write";
  [key: string]: unknown;
}

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

function tupleKey(tuple: TupleKey): string {
  return `${tuple.user} ${tuple.relation} ${tuple.object}`;
}

function nodeKind(object: string): string {
  if (object.includes("#")) return "userset";
  const [type] = object.split(":");
  return type || "unknown";
}

function resourceTypeFromObject(object: string): ResourceType | null {
  const [type] = object.split(":");
  return RESOURCE_TYPES.has(type as ResourceType) ? (type as ResourceType) : null;
}

function defaultRelationForObject(object: string, preferredRelation?: string): string | null {
  const resourceType = resourceTypeFromObject(object);
  if (!resourceType) return null;
  const relations = RELATIONS_BY_TYPE[resourceType];
  return preferredRelation && relations.includes(preferredRelation) ? preferredRelation : relations[0];
}

function tupleFromConnection(
  source: string | null | undefined,
  target: string | null | undefined,
  preferredRelation: string
): TupleKey | null {
  if (!source || !target || source === target) return null;

  if (source.startsWith("user:") && target.startsWith("team:") && !target.includes("#")) {
    return { user: source, relation: "member", object: target };
  }
  if (target.startsWith("user:") && source.startsWith("team:") && !source.includes("#")) {
    return { user: target, relation: "member", object: source };
  }

  if (source.startsWith("team:") && source.endsWith("#member")) {
    const relation = defaultRelationForObject(target, preferredRelation);
    return relation ? { user: source, relation, object: target } : null;
  }
  if (target.startsWith("team:") && target.endsWith("#member")) {
    const relation = defaultRelationForObject(source, preferredRelation);
    return relation ? { user: target, relation, object: source } : null;
  }

  return null;
}

function edgeTuple(edge: GraphEdge): TupleKey {
  return { user: edge.from, relation: edge.relation, object: edge.to };
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
  const [graphScope, setGraphScope] = useState(ALL_RELATIONSHIPS_SCOPE);
  const [graphFullscreenOpen, setGraphFullscreenOpen] = useState(false);
  const [resourceType, setResourceType] = useState<ResourceType>("agent");
  const [resourceId, setResourceId] = useState("");
  const [relation, setRelation] = useState("can_use");
  const [checkResult, setCheckResult] = useState<boolean | null>(null);
  const [tupleFilter, setTupleFilter] = useState<Partial<TupleKey>>({});
  const [pendingGraphWrites, setPendingGraphWrites] = useState<TupleKey[]>([]);
  const [pendingGraphDeletes, setPendingGraphDeletes] = useState<TupleKey[]>([]);

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
    if (graphScope !== ALL_RELATIONSHIPS_SCOPE) params.set("team", graphScope);
    params.set("limit", "1000");
    const res = await fetch(`/api/admin/openfga/graph?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to load graph: ${res.status}`);
    const payload = await res.json();
    setGraph(apiData<{ nodes: GraphNode[]; edges: GraphEdge[] }>(payload));
  }, [graphScope]);

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

  async function applyGraphChanges() {
    if (pendingGraphWrites.length === 0 && pendingGraphDeletes.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/openfga/tuples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writes: pendingGraphWrites, deletes: pendingGraphDeletes }),
      });
      if (!res.ok) throw new Error(`OpenFGA graph save failed: ${res.status}`);
      setMessage(
        `Saved ${pendingGraphWrites.length} grant${pendingGraphWrites.length === 1 ? "" : "s"} and ${
          pendingGraphDeletes.length
        } revoke${pendingGraphDeletes.length === 1 ? "" : "s"}`
      );
      setPendingGraphWrites([]);
      setPendingGraphDeletes([]);
      await Promise.all([loadTuples(), loadGraph()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OpenFGA graph save failed");
    } finally {
      setBusy(false);
    }
  }

  function stageGraphWrite(tuple: TupleKey) {
    setPendingGraphDeletes((prev) => prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple)));
    setPendingGraphWrites((prev) =>
      prev.some((candidate) => tupleKey(candidate) === tupleKey(tuple)) ? prev : [...prev, tuple]
    );
  }

  function stageGraphDelete(tuple: TupleKey) {
    setPendingGraphWrites((prev) => prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple)));
    setPendingGraphDeletes((prev) =>
      prev.some((candidate) => tupleKey(candidate) === tupleKey(tuple)) ? prev : [...prev, tuple]
    );
  }

  function clearGraphChanges() {
    setPendingGraphWrites([]);
    setPendingGraphDeletes([]);
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
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Policy / Resource Graph</CardTitle>
                <CardDescription>
                  Visualizes OpenFGA usersets as edges. Use a team scope or render all relationships in the store.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 self-start"
                onClick={() => setGraphFullscreenOpen(true)}
              >
                <Maximize2 className="h-4 w-4" />
                Full screen
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div>
                  <Label htmlFor="graph-scope">Graph scope</Label>
                  <select
                    id="graph-scope"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={graphScope}
                    onChange={(event) => setGraphScope(event.target.value)}
                  >
                    <option value={ALL_RELATIONSHIPS_SCOPE}>All relationships in the system</option>
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
              <OpenFgaGraphEditor
                catalog={catalog}
                graph={graph}
                teamSlug={graphScope === ALL_RELATIONSHIPS_SCOPE ? "" : graphScope}
                preferredRelation={relation}
                pendingWrites={pendingGraphWrites}
                pendingDeletes={pendingGraphDeletes}
                isAdmin={isAdmin}
                busy={busy}
                onStageWrite={stageGraphWrite}
                onStageDelete={stageGraphDelete}
                onUnstageWrite={(tuple) => {
                  setPendingGraphWrites((prev) => prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple)));
                }}
                onClearChanges={clearGraphChanges}
                onSaveChanges={applyGraphChanges}
              />
              <Dialog open={graphFullscreenOpen} onOpenChange={setGraphFullscreenOpen}>
                <DialogContent className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-3 p-4">
                  <DialogHeader className="pr-10">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <DialogTitle>OpenFGA Policy / Resource Graph</DialogTitle>
                        <DialogDescription>
                          Full-screen relationship workspace for all tuples or a selected team scope.
                        </DialogDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => setGraphFullscreenOpen(false)}
                      >
                        <Minimize2 className="h-4 w-4" />
                        Exit full screen
                      </Button>
                    </div>
                  </DialogHeader>
                  <div className="min-h-0 flex-1">
                    <OpenFgaGraphEditor
                      catalog={catalog}
                      graph={graph}
                      teamSlug={graphScope === ALL_RELATIONSHIPS_SCOPE ? "" : graphScope}
                      preferredRelation={relation}
                      pendingWrites={pendingGraphWrites}
                      pendingDeletes={pendingGraphDeletes}
                      isAdmin={isAdmin}
                      busy={busy}
                      fullscreen
                      onStageWrite={stageGraphWrite}
                      onStageDelete={stageGraphDelete}
                      onUnstageWrite={(tuple) => {
                        setPendingGraphWrites((prev) =>
                          prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple))
                        );
                      }}
                      onClearChanges={clearGraphChanges}
                      onSaveChanges={applyGraphChanges}
                    />
                  </div>
                </DialogContent>
              </Dialog>
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

interface OpenFgaGraphEditorProps {
  catalog: CatalogResponse | null;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  teamSlug: string;
  preferredRelation: string;
  pendingWrites: TupleKey[];
  pendingDeletes: TupleKey[];
  isAdmin: boolean;
  busy: boolean;
  fullscreen?: boolean;
  onStageWrite: (tuple: TupleKey) => void;
  onStageDelete: (tuple: TupleKey) => void;
  onUnstageWrite: (tuple: TupleKey) => void;
  onClearChanges: () => void;
  onSaveChanges: () => void;
}

function OpenFgaGraphEditor(props: OpenFgaGraphEditorProps) {
  return (
    <ReactFlowProvider>
      <OpenFgaGraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function OpenFgaGraphEditorInner({
  catalog,
  graph,
  teamSlug,
  preferredRelation,
  pendingWrites,
  pendingDeletes,
  isAdmin,
  busy,
  fullscreen = false,
  onStageWrite,
  onStageDelete,
  onUnstageWrite,
  onClearChanges,
  onSaveChanges,
}: OpenFgaGraphEditorProps) {
  const reactFlow = useReactFlow();
  const team = catalog?.teams.find((candidate) => candidate.slug === teamSlug);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<RebacNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<RebacEdgeData>>([]);
  const [selectedEdge, setSelectedEdge] = useState<Edge<RebacEdgeData> | null>(null);
  const [graphWarning, setGraphWarning] = useState<string | null>(null);

  useEffect(() => {
    setNodes(buildFlowNodes(graph, teamSlug, team?.name, pendingWrites));
    setEdges(buildFlowEdges(graph, pendingWrites, pendingDeletes));
  }, [graph, pendingDeletes, pendingWrites, setEdges, setNodes, team?.name, teamSlug]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isAdmin) return;
      const tuple = tupleFromConnection(connection.source, connection.target, preferredRelation);
      if (!tuple) {
        setGraphWarning("That edge is not a valid CAIPE OpenFGA relationship.");
        return;
      }
      setGraphWarning(null);
      onStageWrite(tuple);
    },
    [isAdmin, onStageWrite, preferredRelation]
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedEdge((params.edges[0] as Edge<RebacEdgeData> | undefined) ?? null);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/caipe-openfga-resource");
      if (!raw) return;
      const resource = JSON.parse(raw) as CatalogResource & { resourceType: ResourceType };
      const object = resource.object || `${resource.resourceType}:${resource.id}`;
      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setNodes((currentNodes) => {
        if (currentNodes.some((node) => node.id === object)) return currentNodes;
        return [
          ...currentNodes,
          {
            id: object,
            type: "rebac",
            position,
            data: {
              label: resource.name,
              kind: resource.resourceType,
              object,
              description: resource.description,
            },
          },
        ];
      });
    },
    [reactFlow, setNodes]
  );

  const selectedTuple = selectedEdge?.data?.tuple ?? null;
  const selectedIsPendingWrite = selectedEdge?.data?.staged === "write";
  const hasPendingChanges = pendingWrites.length > 0 || pendingDeletes.length > 0;

  return (
    <div className={cn("grid gap-3 xl:grid-cols-[260px_1fr_300px]", fullscreen && "h-full min-h-0")}>
      <GraphResourcePalette catalog={catalog} disabled={!isAdmin} />

      <div className={cn("overflow-hidden rounded-md border bg-background", fullscreen ? "h-full min-h-[640px]" : "h-[560px]")}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={GRAPH_NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onDragOver={onDragOver}
          onDrop={onDrop}
          fitView
          fitViewOptions={{ padding: 0.3 }}
        >
          <Panel position="top-left">
            <div className="rounded-md border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
              Drag a resource into the graph, then connect a team members node to grant access.
            </div>
          </Panel>
          <OpenFgaGraphControls />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="hsl(var(--muted-foreground) / 0.15)"
          />
        </ReactFlow>
      </div>

      <div className="space-y-3">
        {graphWarning && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            {graphWarning}
          </div>
        )}
        <div className="rounded-md border p-3">
          <div className="text-sm font-medium">Selected relationship</div>
          {selectedTuple ? (
            <div className="mt-2 space-y-2">
              <code className="block break-all rounded bg-muted/40 p-2 text-xs">{tupleKey(selectedTuple)}</code>
              <Button
                size="sm"
                variant="outline"
                disabled={!isAdmin || busy}
                onClick={() =>
                  selectedIsPendingWrite ? onUnstageWrite(selectedTuple) : onStageDelete(selectedTuple)
                }
                className="w-full gap-1 text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {selectedIsPendingWrite ? "Remove staged grant" : "Stage revoke"}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Select an edge to stage a revoke.</p>
          )}
        </div>

        <PendingGraphChanges
          writes={pendingWrites}
          deletes={pendingDeletes}
          busy={busy}
          isAdmin={isAdmin}
          onClear={onClearChanges}
          onSave={onSaveChanges}
        />
      </div>
    </div>
  );
}

function buildFlowNodes(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  teamSlug: string,
  teamName: string | undefined,
  pendingWrites: TupleKey[]
): Node<RebacNodeData>[] {
  const nodesById = new Map<string, { id: string; label: string; kind: string }>();
  const addNode = (id: string, label = id, kind = nodeKind(id)) => {
    if (!nodesById.has(id)) nodesById.set(id, { id, label, kind: kind === "team_members" ? "userset" : kind });
  };

  if (teamSlug) {
    addNode(`team:${teamSlug}`, teamName ? `${teamName} team` : `team:${teamSlug}`, "team");
    addNode(`team:${teamSlug}#member`, teamName ? `${teamName} members` : `team:${teamSlug}#member`, "userset");
  }

  graph.nodes.forEach((node) => addNode(node.id, node.label, node.type));
  graph.edges.forEach((edge) => {
    addNode(edge.from);
    addNode(edge.to);
  });
  pendingWrites.forEach((tuple) => {
    addNode(tuple.user);
    addNode(tuple.object);
  });

  const columnByKind: Record<string, number> = {
    user: 0,
    team: 1,
    userset: 1,
    agent: 2,
    tool: 2,
    knowledge_base: 2,
  };
  const rowByColumn: Record<number, number> = {};

  return [...nodesById.values()]
    .sort((left, right) => {
      const leftColumn = columnByKind[left.kind] ?? 3;
      const rightColumn = columnByKind[right.kind] ?? 3;
      return leftColumn - rightColumn || left.label.localeCompare(right.label);
    })
    .map((node) => {
      const column = columnByKind[node.kind] ?? 3;
      const row = rowByColumn[column] ?? 0;
      rowByColumn[column] = row + 1;
      return {
        id: node.id,
        type: "rebac",
        position: { x: 40 + column * 260, y: 60 + row * 110 },
        data: {
          label: node.label,
          kind: node.kind,
          object: node.id,
        },
      };
    });
}

function buildFlowEdges(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  pendingWrites: TupleKey[],
  pendingDeletes: TupleKey[]
): Edge<RebacEdgeData>[] {
  const deleted = new Set(pendingDeletes.map(tupleKey));
  const existingKeys = new Set<string>();
  const persistedEdges = graph.edges
    .map((edge) => ({ edge, tuple: edgeTuple(edge) }))
    .filter(({ tuple }) => !deleted.has(tupleKey(tuple)))
    .map(({ edge, tuple }) => {
      existingKeys.add(tupleKey(tuple));
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.relation,
        data: { tuple },
        labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
        labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      } satisfies Edge<RebacEdgeData>;
    });

  const stagedEdges = pendingWrites
    .filter((tuple) => !existingKeys.has(tupleKey(tuple)))
    .map((tuple) => ({
      id: `pending-${tupleKey(tuple)}`,
      source: tuple.user,
      target: tuple.object,
      label: tuple.relation,
      animated: true,
      data: { tuple, staged: "write" as const },
      labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      style: { stroke: "#10b981", strokeWidth: 2.5, strokeDasharray: "6 4" },
    }));

  return [...persistedEdges, ...stagedEdges];
}

function GraphResourcePalette({ catalog, disabled }: { catalog: CatalogResponse | null; disabled: boolean }) {
  const resourceGroups: Array<{ type: ResourceType; label: string; resources: CatalogResource[] }> = [
    { type: "agent", label: "Agents", resources: catalog?.resources.agents ?? [] },
    { type: "tool", label: "Tools", resources: catalog?.resources.tools ?? [] },
    { type: "knowledge_base", label: "Knowledge bases", resources: catalog?.resources.knowledge_bases ?? [] },
  ];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">Resource palette</div>
        <p className="text-xs text-muted-foreground">Drag resources into the canvas before connecting them.</p>
      </div>
      {resourceGroups.map((group) => (
        <div key={group.type} className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{group.label}</div>
          {group.resources.length === 0 ? (
            <div className="rounded border border-dashed p-2 text-xs text-muted-foreground">No resources found.</div>
          ) : (
            group.resources.slice(0, 8).map((resource) => (
              <button
                key={`${group.type}:${resource.id}`}
                type="button"
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/caipe-openfga-resource",
                    JSON.stringify({ ...resource, resourceType: group.type })
                  );
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="w-full rounded-md border bg-card px-2 py-1.5 text-left text-xs shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="font-medium">{resource.name}</div>
                <code className="text-[10px] text-muted-foreground">{resource.object}</code>
              </button>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function PendingGraphChanges({
  writes,
  deletes,
  busy,
  isAdmin,
  onClear,
  onSave,
}: {
  writes: TupleKey[];
  deletes: TupleKey[];
  busy: boolean;
  isAdmin: boolean;
  onClear: () => void;
  onSave: () => void;
}) {
  const hasChanges = writes.length > 0 || deletes.length > 0;

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Staged changes</div>
        <Badge variant="secondary">{writes.length + deletes.length}</Badge>
      </div>
      <div className="mt-2 max-h-60 space-y-2 overflow-auto">
        {!hasChanges && <p className="text-xs text-muted-foreground">No graph edits staged.</p>}
        {writes.map((tuple) => (
          <div key={`write-${tupleKey(tuple)}`} className="rounded bg-emerald-500/10 p-2 text-xs">
            <Badge className="mb-1">grant</Badge>
            <code className="block break-all">{tupleKey(tuple)}</code>
          </div>
        ))}
        {deletes.map((tuple) => (
          <div key={`delete-${tupleKey(tuple)}`} className="rounded bg-destructive/10 p-2 text-xs">
            <Badge variant="destructive" className="mb-1">
              revoke
            </Badge>
            <code className="block break-all">{tupleKey(tuple)}</code>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={!isAdmin || busy || !hasChanges} onClick={onSave}>
          Save
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !hasChanges} onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function OpenFgaGraphControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const buttonClass =
    "flex h-8 w-8 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/15";

  return (
    <Panel position="bottom-left">
      <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-1 shadow-lg">
        <button type="button" onClick={() => zoomIn()} className={buttonClass} title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomOut()} className={buttonClass} title="Zoom out">
          -
        </button>
        <div className="my-0.5 h-px bg-border" />
        <button type="button" onClick={() => fitView({ padding: 0.3 })} className={buttonClass} title="Fit view">
          fit
        </button>
      </div>
    </Panel>
  );
}

function RebacGraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as RebacNodeData;
  const styles: Record<string, string> = {
    user: "border-sky-400 bg-sky-500/10",
    team: "border-violet-400 bg-violet-500/10",
    userset: "border-indigo-400 bg-indigo-500/10",
    agent: "border-emerald-400 bg-emerald-500/10",
    tool: "border-amber-400 bg-amber-500/10",
    knowledge_base: "border-rose-400 bg-rose-500/10",
  };

  return (
    <div
      className={cn(
        "w-[210px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-all",
        styles[nodeData.kind] ?? "border-border",
        selected && "ring-2 ring-primary/40"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Badge variant="secondary" className="mb-1 text-[10px]">
            {nodeData.kind}
          </Badge>
          <div className="truncate text-sm font-medium">{nodeData.label}</div>
          <code className="block truncate text-[10px] text-muted-foreground">{nodeData.object}</code>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary" />
    </div>
  );
}

const RebacGraphNode = memo(RebacGraphNodeComponent);
const GRAPH_NODE_TYPES = { rebac: RebacGraphNode };

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
