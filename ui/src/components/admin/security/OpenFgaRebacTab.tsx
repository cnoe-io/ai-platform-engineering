"use client";

// Read-only OpenFGA relationship graph.
//
// This surface used to host four tabs (Tuples, Policy Graph editor, Manifest,
// Default FGA Grants) plus drag-to-connect grant editing. All direct-editing
// affordances were removed: grants are authored through Teams → resource
// assignment (which reconciles tuples), and per-user/per-team access is read in
// the Teams/Users workflows. What remains here is a visualization for seeing
// how team → resource relationships and effective access resolve in OpenFGA.

import { memo, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Bot,
  Database,
  GitBranch,
  Hash,
  MessageSquare,
  Shield,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { RebacGraphFilters, type RebacGraphUserOption } from "../rebac/RebacGraphFilters";

type GraphLayer = "tuples" | "effective" | "model";

interface CatalogTeam {
  id: string;
  slug: string;
  name: string;
}

interface CatalogResponse {
  status: {
    configured: boolean;
    reconcile_enabled: boolean;
    store_name: string;
  };
  teams: CatalogTeam[];
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
  kind?: "openfga" | "metadata" | "effective" | "model";
  layer?: "tuples" | "metadata" | "effective" | "model";
  metadata?: {
    source_type: "slack_channel_team_mapping" | "webex_space_team_mapping";
    label: string;
    readonly: true;
  };
}

const ALL_RELATIONSHIPS_SCOPE = "__all_relationships__";
const DEFAULT_GRAPH_LAYER: GraphLayer = "tuples";

interface RebacNodeData {
  label: string;
  kind: string;
  object: string;
  description?: string;
  [key: string]: unknown;
}

interface RebacEdgeData {
  metadata?: GraphEdge["metadata"];
  [key: string]: unknown;
}

interface FlowNodeDefinition {
  id: string;
  label: string;
  kind: string;
  object?: string;
  items?: string[];
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function statusBadge(catalog: CatalogResponse | null) {
  if (!catalog?.status.configured) {
    return <Badge variant="destructive">OpenFGA not configured</Badge>;
  }
  if (!catalog.status.reconcile_enabled) {
    return <Badge variant="secondary">Reconciliation disabled</Badge>;
  }
  return <Badge variant="default">OpenFGA reconciliation enabled</Badge>;
}

function nodeKind(object: string): string {
  if (object.includes("#")) return "userset";
  const [type] = object.split(":");
  return type || "unknown";
}

const GRAPH_KIND_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  user: { label: "User", icon: User, className: "border-sky-400 bg-sky-500/10" },
  user_profile: { label: "User Profile", icon: User, className: "border-sky-400 bg-sky-500/10" },
  team: { label: "Team", icon: Shield, className: "border-violet-400 bg-violet-500/10" },
  userset: { label: "Userset", icon: Users, className: "border-indigo-400 bg-indigo-500/10" },
  admin_surface: { label: "Admin Surface", icon: Shield, className: "border-fuchsia-400 bg-fuchsia-500/10" },
  agent: { label: "Agent", icon: Bot, className: "border-emerald-400 bg-emerald-500/10" },
  mcp_gateway: { label: "AgentGateway", icon: Wrench, className: "border-amber-400 bg-amber-500/10" },
  mcp_server: { label: "MCP Server", icon: Wrench, className: "border-amber-400 bg-amber-500/10" },
  tool: { label: "Tool", icon: Wrench, className: "border-amber-400 bg-amber-500/10" },
  knowledge_base: { label: "Knowledge Base", icon: Database, className: "border-rose-400 bg-rose-500/10" },
  slack_channel: { label: "Slack Channel", icon: Hash, className: "border-cyan-400 bg-cyan-500/10" },
  webex_space: { label: "Webex Space", icon: MessageSquare, className: "border-violet-400 bg-violet-500/10" },
  model_resource_type: { label: "Model Type", icon: Database, className: "border-blue-400 bg-blue-500/10" },
  model_relation: { label: "Model Relation", icon: GitBranch, className: "border-amber-400 bg-amber-500/10" },
  model_permission: { label: "Model Permission", icon: Shield, className: "border-emerald-400 bg-emerald-500/10" },
  model_relation_stack: { label: "Relation Stack", icon: GitBranch, className: "border-amber-400 bg-amber-500/10" },
  model_permission_stack: { label: "Permission Stack", icon: Shield, className: "border-emerald-400 bg-emerald-500/10" },
};

function graphKindMeta(kind: string) {
  return GRAPH_KIND_META[kind] ?? {
    label: kind.replace(/_/g, " ") || "Resource",
    icon: Database,
    className: "border-border bg-card",
  };
}

function modelTypeFromNodeId(nodeId: string): string | null {
  const match = /^model:(?:resource_type|relation|permission|relation_stack|permission_stack):([^:]+)/.exec(nodeId);
  return match?.[1] ?? null;
}

function modelStackItems(
  graph: { nodes: GraphNode[] },
  modelType: string,
  nodeType: "model_relation" | "model_permission"
): string[] {
  return [
    ...new Set(
      graph.nodes
        .filter((node) => node.type === nodeType && modelTypeFromNodeId(node.id) === modelType)
        .map((node) => node.label)
        .filter(Boolean)
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function OpenFgaRebacTab({ isAdmin }: { isAdmin: boolean }) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphScope, setGraphScope] = useState(ALL_RELATIONSHIPS_SCOPE);
  const [graphLayer, setGraphLayer] = useState<GraphLayer>(DEFAULT_GRAPH_LAYER);
  const [graphUser, setGraphUser] = useState<RebacGraphUserOption | null>(null);
  const [graphFullscreenOpen, setGraphFullscreenOpen] = useState(false);

  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/admin/openfga/catalog");
    if (!res.ok) throw new Error(`Failed to load catalog: ${res.status}`);
    const payload = await res.json();
    setCatalog(apiData<CatalogResponse>(payload));
  }, []);

  const loadGraph = useCallback(async () => {
    const params = new URLSearchParams();
    if (graphScope !== ALL_RELATIONSHIPS_SCOPE) params.set("team", graphScope);
    if (graphUser) params.set("subject", `user:${graphUser.id}`);
    params.set("layer", graphLayer);
    params.set("limit", "1000");
    const res = await fetch(`/api/admin/rebac/graph?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to load graph: ${res.status}`);
    const payload = await res.json();
    setGraph(apiData<{ nodes: GraphNode[]; edges: GraphEdge[] }>(payload));
  }, [graphLayer, graphScope, graphUser]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadCatalog();
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load OpenFGA data");
    } finally {
      setLoading(false);
    }
  }, [loadCatalog, loadGraph]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Admin access required.</p>;
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading OpenFGA relationship graph...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Policy Graph</h2>
          <p className="text-sm text-muted-foreground">
            Visualize team-to-resource relationships and effective access enforced by AgentGateway ext_authz.
            Grants are authored in Teams; this view is read-only.
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
          <RebacGraphFilters
            teams={catalog?.teams ?? []}
            scope={graphScope}
            layer={graphLayer}
            allScopeValue={ALL_RELATIONSHIPS_SCOPE}
            selectedUser={graphUser}
            onScopeChange={setGraphScope}
            onLayerChange={setGraphLayer}
            onUserChange={setGraphUser}
            onRender={loadGraph}
          />
          {graphLayer === "effective" && !graphUser && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Effective access is a user-centered view. Select a user, then render the graph to see that user&apos;s direct and inherited access paths.
            </p>
          )}
          <GraphSummary graph={graph} />
          <OpenFgaGraphViewer
            graph={graph}
            graphLayer={graphLayer}
            teamSlug={graphScope === ALL_RELATIONSHIPS_SCOPE ? "" : graphScope}
            teamName={catalog?.teams.find((candidate) => candidate.slug === graphScope)?.name}
            showUsers={Boolean(graphUser)}
          />
          <GraphDetails graph={graph} />
          <Dialog open={graphFullscreenOpen} onOpenChange={setGraphFullscreenOpen}>
            <DialogContent className="flex h-[92vh] max-h-[92vh] min-w-0 w-[96vw] max-w-[96vw] flex-col gap-3 overflow-hidden p-4">
              <DialogHeader className="min-w-0 shrink-0 pr-10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <DialogTitle>OpenFGA Policy / Resource Graph</DialogTitle>
                    <DialogDescription>
                      Full-screen relationship view for all tuples or a selected team scope.
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
              <div className="min-w-0 shrink-0 rounded-md border bg-muted/10 p-3">
                <RebacGraphFilters
                  teams={catalog?.teams ?? []}
                  scope={graphScope}
                  layer={graphLayer}
                  allScopeValue={ALL_RELATIONSHIPS_SCOPE}
                  selectedUser={graphUser}
                  idPrefix="graph-fullscreen"
                  onScopeChange={setGraphScope}
                  onLayerChange={setGraphLayer}
                  onUserChange={setGraphUser}
                  onRender={loadGraph}
                />
                {graphLayer === "effective" && !graphUser && (
                  <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    Effective access is a user-centered view. Select a user before rendering this layer.
                  </p>
                )}
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <OpenFgaGraphViewer
                  graph={graph}
                  graphLayer={graphLayer}
                  teamSlug={graphScope === ALL_RELATIONSHIPS_SCOPE ? "" : graphScope}
                  teamName={catalog?.teams.find((candidate) => candidate.slug === graphScope)?.name}
                  showUsers={Boolean(graphUser)}
                  fullscreen
                />
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

function GraphSummary({ graph }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }) {
  const grouped = graph.edges.reduce<Record<string, GraphEdge[]>>((acc, edge) => {
    acc[edge.relation] = [...(acc[edge.relation] ?? []), edge];
    return acc;
  }, {});

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <MetricCard label="Nodes" value={graph.nodes.length} />
      <MetricCard label="Relationships" value={graph.edges.length} />
      <MetricCard label="Relation types" value={Object.keys(grouped).length} />
    </div>
  );
}

function GraphDetails({ graph }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Node and edge details</div>
          <p className="text-xs text-muted-foreground">
            Raw graph inventory is collapsed by default to keep the policy canvas readable.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Hide node and edge details" : "Show node and edge details"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">Nodes</div>
            <div className="flex flex-wrap gap-2">
              {graph.nodes.length === 0 ? (
                <span className="text-sm text-muted-foreground">No graph nodes loaded.</span>
              ) : (
                graph.nodes.map((node) => {
                  const meta = graphKindMeta(node.type);
                  const Icon = meta.icon;
                  return (
                    <Badge key={node.id} variant="secondary" className="gap-1.5">
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      <span className="text-muted-foreground">{meta.label}</span>
                      {node.label}
                    </Badge>
                  );
                })
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
                    {edge.kind === "metadata" && (
                      <Badge variant="outline" className="mb-1">
                        routing metadata
                      </Badge>
                    )}
                    <code>{edge.from}</code> <span className="text-muted-foreground">{edge.relation}</span>{" "}
                    <code>{edge.to}</code>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface OpenFgaGraphViewerProps {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  graphLayer: GraphLayer;
  teamSlug: string;
  teamName?: string;
  showUsers?: boolean;
  fullscreen?: boolean;
}

function OpenFgaGraphViewer(props: OpenFgaGraphViewerProps) {
  return (
    <ReactFlowProvider>
      <OpenFgaGraphViewerInner {...props} />
    </ReactFlowProvider>
  );
}

function OpenFgaGraphViewerInner({
  graph,
  graphLayer,
  teamSlug,
  teamName,
  showUsers = false,
  fullscreen = false,
}: OpenFgaGraphViewerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<RebacNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<RebacEdgeData>>([]);

  useEffect(() => {
    const nextNodes = buildFlowNodes(graph, teamSlug, teamName, showUsers, graphLayer);
    const visibleNodeIds = new Set(nextNodes.map((node) => node.id));
    setNodes(nextNodes);
    setEdges(buildFlowEdges(graph, visibleNodeIds, graphLayer));
  }, [graph, graphLayer, setEdges, setNodes, showUsers, teamName, teamSlug]);

  return (
    <div
      data-testid="openfga-graph-canvas"
      className={cn(
        "min-w-0 overflow-hidden rounded-md border bg-background",
        fullscreen ? "h-full min-h-0" : "h-[560px]"
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={GRAPH_NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.3 }}
      >
        <OpenFgaGraphControls />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(var(--muted-foreground) / 0.15)"
        />
      </ReactFlow>
    </div>
  );
}

function buildFlowNodes(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  teamSlug: string,
  teamName: string | undefined,
  showUsers: boolean,
  graphLayer: GraphLayer
): Node<RebacNodeData>[] {
  const nodesById = new Map<string, FlowNodeDefinition>();
  const addNode = (id: string, label = id, kind = nodeKind(id), extra: Partial<FlowNodeDefinition> = {}) => {
    if (!nodesById.has(id)) {
      nodesById.set(id, { id, label, kind: kind === "team_members" ? "userset" : kind, object: id, ...extra });
    }
  };

  if (graphLayer !== "model" && teamSlug) {
    addNode(`team:${teamSlug}`, teamName ? `${teamName} team` : `team:${teamSlug}`, "team");
    addNode(`team:${teamSlug}#member`, teamName ? `${teamName} members` : `team:${teamSlug}#member`, "userset");
    addNode(`team:${teamSlug}#admin`, teamName ? `${teamName} admins` : `team:${teamSlug}#admin`, "userset");
  }

  if (graphLayer === "model") {
    graph.nodes
      .filter((node) => node.type === "model_resource_type")
      .forEach((node) => addNode(node.id, node.label, node.type));
    new Set(
      graph.nodes
        .filter((node) => node.type === "model_resource_type")
        .map((node) => modelTypeFromNodeId(node.id))
        .filter((type): type is string => Boolean(type))
    ).forEach((modelType) => {
      const relationItems = modelStackItems(graph, modelType, "model_relation");
      const permissionItems = modelStackItems(graph, modelType, "model_permission");
      if (relationItems.length > 0) {
        addNode(`model:relation_stack:${modelType}`, "Relations", "model_relation_stack", { items: relationItems });
      }
      if (permissionItems.length > 0) {
        addNode(`model:permission_stack:${modelType}`, "Permissions", "model_permission_stack", {
          items: permissionItems,
        });
      }
    });
  } else {
    graph.nodes.forEach((node) => addNode(node.id, node.label, node.type));
    graph.edges.forEach((edge) => {
      addNode(edge.from);
      addNode(edge.to);
    });
  }

  const visibleNodes = [...nodesById.values()].filter((node) => {
    if (node.kind === "model_resource_type") return true;
    if (node.kind === "model_relation_stack" || node.kind === "model_permission_stack") return graphLayer === "model";
    if (node.kind === "model_relation" || node.kind === "model_permission") return false;
    if (node.kind === "team" || node.kind === "userset") return true;
    if (node.kind === "user") return showUsers;
    return true;
  });

  const columnForKind = (kind: string): number => {
    if (kind === "user" || kind === "slack_channel" || kind === "webex_space" || kind === "external_group") return 0;
    if (kind === "team" || kind === "userset") return 1;
    if (kind === "model_resource_type") return 0;
    if (kind === "model_relation_stack") return 1;
    if (kind === "model_permission_stack") return 2;
    return 2;
  };
  const rowByColumn: Record<number, number> = {};

  return visibleNodes
    .sort((left, right) => {
      const leftColumn = columnForKind(left.kind);
      const rightColumn = columnForKind(right.kind);
      return leftColumn - rightColumn || left.label.localeCompare(right.label);
    })
    .map((node) => {
      const column = columnForKind(node.kind);
      const row = rowByColumn[column] ?? 0;
      rowByColumn[column] = row + 1;
      return {
        id: node.id,
        type: "rebac",
        position: { x: 40 + column * 260, y: 60 + row * 110 },
        data: {
          label: node.label,
          kind: node.kind,
          object: node.object ?? node.id,
          items: node.items,
        },
      };
    });
}

function buildFlowEdges(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  visibleNodeIds: Set<string>,
  graphLayer: GraphLayer
): Edge<RebacEdgeData>[] {
  const persistedEdges = graph.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .map((edge) => {
      const isMetadata = edge.kind === "metadata";
      const isEffective = edge.kind === "effective";
      const isModel = edge.kind === "model";
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: isMetadata ? `${edge.relation} (metadata)` : isEffective ? `${edge.relation} (effective)` : edge.relation,
        data: { metadata: edge.metadata },
        labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
        labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        style: isMetadata
          ? { stroke: "hsl(var(--muted-foreground))", strokeWidth: 2, strokeDasharray: "4 4" }
          : isEffective
            ? { stroke: "#10b981", strokeWidth: 2.5 }
            : isModel
              ? { stroke: "#60a5fa", strokeWidth: 2, strokeDasharray: "3 3" }
              : { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      } satisfies Edge<RebacEdgeData>;
    });

  const modelStackEdges = graphLayer === "model" ? buildModelStackEdges(visibleNodeIds) : [];
  return [...persistedEdges, ...modelStackEdges];
}

function buildModelStackEdges(visibleNodeIds: Set<string>): Edge<RebacEdgeData>[] {
  return [...visibleNodeIds].flatMap((nodeId) => {
    if (!nodeId.startsWith("model:resource_type:")) return [];
    const modelType = modelTypeFromNodeId(nodeId);
    if (!modelType) return [];

    const relationStackId = `model:relation_stack:${modelType}`;
    const permissionStackId = `model:permission_stack:${modelType}`;
    const edges: Edge<RebacEdgeData>[] = [];
    if (visibleNodeIds.has(relationStackId)) {
      edges.push({
        id: `model-stack-${modelType}-relations`,
        source: nodeId,
        target: relationStackId,
        label: "relations",
        data: { metadata: undefined },
        labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
        labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        style: { stroke: "#60a5fa", strokeWidth: 2, strokeDasharray: "3 3" },
      });
    }
    if (visibleNodeIds.has(permissionStackId)) {
      edges.push({
        id: `model-stack-${modelType}-permissions`,
        source: visibleNodeIds.has(relationStackId) ? relationStackId : nodeId,
        target: permissionStackId,
        label: "permissions",
        data: { metadata: undefined },
        labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
        labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        style: { stroke: "#60a5fa", strokeWidth: 2, strokeDasharray: "3 3" },
      });
    }
    return edges;
  });
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
  const meta = graphKindMeta(nodeData.kind);
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "w-[210px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-all",
        meta.className,
        selected && "ring-2 ring-primary/40"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Badge variant="secondary" className="mb-1 gap-1 text-[10px]">
            <Icon className="h-3 w-3" aria-hidden="true" />
            {meta.label}
          </Badge>
          <div className="truncate text-sm font-medium">{nodeData.label}</div>
          <code className="block truncate text-[10px] text-muted-foreground">{nodeData.object}</code>
          {Array.isArray(nodeData.items) && nodeData.items.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {nodeData.items.slice(0, 6).map((item) => (
                <span key={item} className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {item}
                </span>
              ))}
              {nodeData.items.length > 6 && (
                <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  +{nodeData.items.length - 6} more
                </span>
              )}
            </div>
          )}
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
