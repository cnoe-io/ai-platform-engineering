"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SigmaContainer, useSetSettings, useSigma } from "@react-sigma/core";
import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useTheme } from "next-themes";
import { ArrowUpRight, ChevronRight, Loader2, Network, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/shared/timeline/MarkdownRenderer";
import { parseTomeHref, wikiRoute } from "@/lib/tome/tome-links";
import { cn } from "@/lib/utils";
import "@/components/rag/graph/shared/sigma-styles.css";

import CameraController from "@/components/rag/graph/shared/SigmaGraph/controllers/CameraController";
import GraphDragController from "@/components/rag/graph/shared/SigmaGraph/controllers/GraphDragController";
import GraphEventsController from "@/components/rag/graph/shared/SigmaGraph/controllers/GraphEventsController";
import SigmaInstanceCapture from "@/components/rag/graph/shared/SigmaGraph/controllers/SigmaInstanceCapture";

interface EdgeRow {
  path: string;
  relation: string;
  source: string;
  target: string;
  evidence: string[];
  confidence: string | null;
  status: string;
  body: string;
}

interface OutgoingRow extends EdgeRow {
  target_project_slug: string;
}

interface IncomingRow extends EdgeRow {
  source_project_slug: string;
}

interface EdgesResponse {
  outgoing: OutgoingRow[];
  incoming: IncomingRow[];
  titles: Record<string, string>;
}

/** One edge, normalized to "this project" <-> "other project" regardless of
 * which side authored it — what the click-details panel renders per row. */
interface NormalizedEdge {
  otherSlug: string;
  direction: "outgoing" | "incoming"; // outgoing = authored by this project
  relation: string;
  source: string;
  target: string;
  evidence: string[];
  confidence: string | null;
  status: string;
  body: string;
  /** The project that actually owns the edge FILE (source side, per the storage decision) — where "Open edge" links. */
  edgeOwnerSlug: string;
  path: string;
}

/** Resolve a `tome://` or `https://` ref to a clickable href, or null for
 * anything else (e.g. plain-text evidence like "stated by project team"). */
function refHref(ref: string, ownerSlug: string): string | null {
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  const target = parseTomeHref(ref);
  return target ? wikiRoute(target.project ?? ownerSlug, target.path) : null;
}

// A single hue for the whole graph (nodes and edges alike) — status is
// conveyed by fading the edge, not by picking a different color per status.
// One less thing to decode.
const EDGE_RGB = "129, 140, 248"; // indigo-400
const NODE_COLOR = "#818cf8";
const STATUS_OPACITY: Record<string, number> = { active: 0.95, resolved: 0.5, stale: 0.25 };
const STATUS_LABEL: Record<string, string> = { active: "Active", resolved: "Resolved", stale: "Stale" };

function edgeColor(status: string): string {
  return `rgba(${EDGE_RGB}, ${STATUS_OPACITY[status] ?? STATUS_OPACITY.active})`;
}

function edgesForNode(data: EdgesResponse, slug: string, nodeId: string): NormalizedEdge[] {
  const out: NormalizedEdge[] = [];
  for (const e of data.outgoing) {
    if (nodeId !== slug && e.target_project_slug !== nodeId) continue;
    out.push({
      otherSlug: e.target_project_slug,
      direction: "outgoing",
      relation: e.relation,
      source: e.source,
      target: e.target,
      evidence: e.evidence,
      confidence: e.confidence,
      status: e.status,
      body: e.body,
      edgeOwnerSlug: slug,
      path: e.path,
    });
  }
  for (const e of data.incoming) {
    if (nodeId !== slug && e.source_project_slug !== nodeId) continue;
    out.push({
      otherSlug: e.source_project_slug,
      direction: "incoming",
      relation: e.relation,
      source: e.source,
      target: e.target,
      evidence: e.evidence,
      confidence: e.confidence,
      status: e.status,
      body: e.body,
      edgeOwnerSlug: e.source_project_slug,
      path: e.path,
    });
  }
  return out;
}

/**
 * Force-directed graph of this project's edges: this project at the center,
 * every project it names in an outgoing edge or that names it in an incoming
 * one, laid out with ForceAtlas2 (same engine as the RAG graph views — see
 * components/rag/graph). Read-only; click a node to see the relationship(s)
 * and open the project or the edge itself.
 */
export function EdgeGraphDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EdgesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefetchedData, setPrefetchedData] = useState<EdgesResponse | null>(null);

  useEffect(() => {
    fetch(`/api/tome/projects/${slug}/edges`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setPrefetchedData(body?.data ?? { outgoing: [], incoming: [], titles: {} }))
      .catch(() => {/* silent — count badge is best-effort */});
  }, [slug]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  // Only one edge row expanded at a time — accordion, not a checklist.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sigma's own type is not exported cleanly for this use
  const [sigma, setSigma] = useState<any>(null);
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark" || resolvedTheme?.includes("night") || resolvedTheme === "midnight";
  const labelDefault = isDarkMode ? "#e5e7eb" : "#1f2937"; // gray-200 / gray-800

  // Fetch on open — reuse prefetched data when available to avoid a second
  // round-trip for the same slug.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      setSelectedNode(null);
      setSearch("");
      if (!next) return;
      if (prefetchedData) {
        setData(prefetchedData);
        return;
      }
      setLoading(true);
      setError(null);
      fetch(`/api/tome/projects/${slug}/edges`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((body) => setData(body?.data ?? { outgoing: [], incoming: [], titles: {} }))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [slug, prefetchedData],
  );

  const nodeCount = prefetchedData
    ? new Set([
        slug,
        ...prefetchedData.outgoing.map((e) => e.target_project_slug),
        ...prefetchedData.incoming.map((e) => e.source_project_slug),
      ]).size
    : null;

  // A stable graph instance, mutated imperatively (not recomputed in render —
  // `Math.random` for the initial scatter layout is an impure call, so it has
  // to live in an effect, same as DataGraphSigma's `buildGraph`).
  const graph = useMemo(() => new MultiDirectedGraph(), []);

  useEffect(() => {
    graph.clear();
    if (!data) return;

    const title = (s: string) => data.titles[s] || s;
    const ensureNode = (nodeSlug: string) => {
      if (graph.hasNode(nodeSlug)) return;
      const isCenter = nodeSlug === slug;
      const angle = Math.random() * 2 * Math.PI;
      const radius = isCenter ? 0 : 200 + Math.random() * 100;
      graph.addNode(nodeSlug, {
        label: title(nodeSlug),
        size: isCenter ? 22 : 14,
        color: NODE_COLOR,
        labelColor: labelDefault,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    };

    ensureNode(slug);
    for (const e of data.outgoing) {
      ensureNode(e.target_project_slug);
      graph.addEdge(slug, e.target_project_slug, {
        label: e.relation,
        type: "arrow",
        size: 2,
        color: edgeColor(e.status),
      });
    }
    for (const e of data.incoming) {
      ensureNode(e.source_project_slug);
      graph.addEdge(e.source_project_slug, slug, {
        label: e.relation,
        type: "arrow",
        size: 2,
        color: edgeColor(e.status),
      });
    }

    if (graph.order > 1) {
      forceAtlas2.assign(graph, {
        iterations: 100,
        settings: { gravity: 1, scalingRatio: 12, slowDown: 0.6, barnesHutOptimize: true },
      });
    }
    // No forced SigmaContainer remount: react-sigma observes graphology's own
    // update events, so mutating this stable instance in place is enough —
    // <SigmaContainer> mounts once `!isEmpty` flips true and just reflects it.
  }, [graph, data, slug, labelDefault]);

  const selectNode = useCallback(
    (nodeId: string) => {
      setSelectedNode(nodeId);
      setExpandedKey(null); // fresh accordion state per selection
      setSearch("");
      // Best-effort camera focus — meaningful once the graph has enough nodes
      // that they're not all on screen at once (the whole point of search).
      try {
        const pos = sigma?.getNodeDisplayData(nodeId);
        if (pos) sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.5 }, { duration: 400 });
      } catch {
        /* best-effort only */
      }
    },
    [sigma],
  );

  const isEmpty = !loading && !error && data && data.outgoing.length === 0 && data.incoming.length === 0;
  const selectedEdges = data && selectedNode ? edgesForNode(data, slug, selectedNode) : [];

  const searchMatches =
    data && search.trim()
      ? Object.entries(data.titles)
          .filter(([, title]) => title.toLowerCase().includes(search.trim().toLowerCase()))
          .slice(0, 6)
      : [];

  const toggleExpanded = (key: string) => setExpandedKey((prev) => (prev === key ? null : key));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-auto gap-1.5 px-2 py-1">
          <Network className="h-3.5 w-3.5" />
          Graph
          {nodeCount !== null && nodeCount > 1 && (
            <span className="rounded-full bg-muted px-1 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
              {nodeCount} nodes
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            Edges graph
          </DialogTitle>
          <DialogDescription>
            Typed, evidenced relationships between this project and others: blocks,
            depends-on, supersedes, duplicates, contradicts, relates-to.
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 rounded-lg border bg-muted/20">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-destructive">
              {error}
            </div>
          )}
          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
              No edges yet. Ask chat to create one, or the ingest agent will author edges it
              discovers with real evidence.
            </div>
          )}
          {!loading && !error && !isEmpty && (
            <>
              <SigmaContainer
                graph={graph}
                style={{ width: "100%", height: "100%" }}
                settings={{
                  renderEdgeLabels: true,
                  defaultEdgeType: "arrow",
                  labelRenderedSizeThreshold: 5,
                  labelDensity: 0.5,
                  labelFont: "Inter, system-ui, sans-serif",
                  labelWeight: "600",
                  labelSize: 12,
                  // Read per-node `labelColor` (set above) instead of one flat
                  // color — a flat white-in-dark-mode color plus Sigma's
                  // hover/select state (which draws a white pill behind the
                  // label) made hovered labels invisible.
                  labelColor: { attribute: "labelColor", color: labelDefault },
                  edgeLabelSize: 10,
                  edgeLabelColor: { color: labelDefault },
                  zIndex: true,
                  allowInvalidContainer: true,
                }}
              >
                <SigmaInstanceCapture onSigmaReady={setSigma} />
                <CameraController />
                <GraphDragController setIsDragging={setIsDragging} />
                <GraphAppearance hoveredNode={hoveredNode} selectedNode={selectedNode} />
                <GraphEventsController
                  setHoveredNode={setHoveredNode}
                  onNodeClick={selectNode}
                  isDragging={isDragging}
                />
              </SigmaContainer>

              {/* Search — find a project by name and jump to it. Matters once
                  a graph has enough nodes that they overlap or run off screen. */}
              <div className="absolute left-2 top-2 w-56">
                <div className="flex items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 shadow-sm">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a project…"
                    className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
                {searchMatches.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-md border bg-popover shadow-sm">
                    {searchMatches.map(([matchSlug, title]) => (
                      <button
                        key={matchSlug}
                        type="button"
                        onClick={() => selectNode(matchSlug)}
                        className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        {title}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Status legend — one hue, faded by status, so there's a
                  single color story instead of a per-status palette. */}
              <div className="absolute bottom-2 left-2 flex items-center gap-3 rounded-md border bg-background/90 px-2.5 py-1.5 text-[11px] shadow-sm">
                <span className="font-medium text-foreground">Edge status</span>
                {Object.entries(STATUS_LABEL).map(([key, label]) => (
                  <span key={key} className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: edgeColor(key) }}
                    />
                    {label}
                  </span>
                ))}
              </div>

              {/* Click-details panel: the relationship(s) touching the
                  clicked node, as a collapsible list — never an automatic
                  navigate-away on click. Rows highlight their edge on the
                  canvas on hover, so the two sides read as one view. */}
              {selectedNode && (
                <div className="absolute right-2 top-2 flex max-h-[calc(100%-1rem)] w-80 flex-col overflow-hidden rounded-lg border bg-popover shadow-lg">
                  <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                    <h4 className="truncate text-base font-semibold">
                      {data?.titles[selectedNode] || selectedNode}
                    </h4>
                    <div className="flex shrink-0 items-center gap-2">
                      {selectedNode !== slug && (
                        <Link
                          href={`/projects/${selectedNode}/tome`}
                          className="text-muted-foreground hover:text-foreground"
                          title="Open project wiki"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedNode(null)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {selectedEdges.length === 0 && (
                      <p className="p-4 text-sm text-muted-foreground">No edges for this node.</p>
                    )}
                    <div className="divide-y">
                      {selectedEdges.map((e) => {
                        const key = `${e.edgeOwnerSlug}:${e.path}`;
                        const isOpen = expandedKey === key;
                        const otherTitle = data?.titles[e.otherSlug] || e.otherSlug;
                        const thisTitle = data?.titles[slug] || slug;
                        const [fromTitle, toTitle] =
                          e.direction === "outgoing" ? [thisTitle, otherTitle] : [otherTitle, thisTitle];
                        return (
                          <div
                            key={key}
                            onMouseEnter={() => setHoveredNode(e.otherSlug)}
                            onMouseLeave={() => setHoveredNode(null)}
                            className={cn(isOpen && "bg-accent/60")}
                          >
                            <button
                              type="button"
                              onClick={() => toggleExpanded(key)}
                              className={cn(
                                "flex w-full items-start gap-2 px-4 py-2.5 text-left",
                                isOpen ? "hover:bg-accent/80" : "hover:bg-accent",
                              )}
                            >
                              <ChevronRight
                                className={cn(
                                  "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                  isOpen && "rotate-90",
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  {fromTitle} → {toTitle}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {e.relation}
                                  {e.confidence && ` · ${e.confidence} confidence`}
                                  {e.status !== "active" && ` · ${STATUS_LABEL[e.status] ?? e.status}`}
                                </p>
                              </div>
                            </button>

                            {isOpen && (
                              <div className="flex flex-col gap-2.5 px-4 pb-3 pl-9">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <RefLabel refText={e.source} href={refHref(e.source, e.edgeOwnerSlug)} />
                                  <span>→</span>
                                  <RefLabel refText={e.target} href={refHref(e.target, e.edgeOwnerSlug)} />
                                </div>

                                {e.body && (
                                  <MarkdownRenderer
                                    content={e.body}
                                    variant="thinking"
                                    onInternalLink={(path) =>
                                      window.location.assign(wikiRoute(e.edgeOwnerSlug, path))
                                    }
                                  />
                                )}

                                {e.evidence.length > 0 && (
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Evidence
                                    </span>
                                    {e.evidence.map((ev) => {
                                      const href = refHref(ev, e.edgeOwnerSlug);
                                      return href ? (
                                        <Link
                                          key={ev}
                                          href={href}
                                          className="truncate text-xs text-primary hover:underline"
                                        >
                                          {ev}
                                        </Link>
                                      ) : (
                                        <span key={ev} className="truncate text-xs text-muted-foreground">
                                          {ev}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                <Link
                                  href={wikiRoute(e.edgeOwnerSlug, e.path)}
                                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                                >
                                  Open edge
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </Link>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A `source`/`target` ref, stripped of the `tome://` scheme for readability,
 * linked when it resolves to a real page. */
function RefLabel({ refText, href }: { refText: string; href: string | null }) {
  const label = refText.replace(/^tome:\/\//, "");
  if (!href) return <span className="truncate">{label}</span>;
  return (
    <Link href={href} className="truncate hover:text-primary hover:underline">
      {label}
    </Link>
  );
}

/**
 * Purpose-built appearance controller (replacing the shared RAG-graph
 * `GraphSettingsController`, whose "explored/selected" reducer conflated
 * hover with a color-darkening + white-label-pill treatment that fought our
 * status colors). Hover only ever hides labels on unrelated nodes and
 * emphasizes touching edges — it never recolors anything, so the status
 * legend always matches what's on screen. Driven by both canvas hover AND
 * hovering a row in the details panel (same `hoveredNode` state), so the two
 * surfaces read as connected.
 */
function GraphAppearance({
  hoveredNode,
  selectedNode,
}: {
  hoveredNode: string | null;
  selectedNode: string | null;
}) {
  const sigma = useSigma();
  const setSettings = useSetSettings();
  const graph = sigma.getGraph();

  useEffect(() => {
    setSettings({
      nodeReducer: (node, data) => {
        const res = { ...data };
        const isFocused = node === hoveredNode || node === selectedNode;
        const isHoverNeighbor = hoveredNode ? graph.neighbors(hoveredNode).includes(node) : false;
        if (isFocused) {
          res.forceLabel = true;
          res.zIndex = 1;
        } else if (hoveredNode && !isHoverNeighbor) {
          res.label = null; // de-emphasize unrelated nodes by hiding their label only
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        if (hoveredNode) {
          const touches = graph.source(edge) === hoveredNode || graph.target(edge) === hoveredNode;
          res.size = touches ? (data.size ?? 2) * 1.5 : data.size;
          res.zIndex = touches ? 1 : 0;
        }
        return res;
      },
    });
  }, [hoveredNode, selectedNode, setSettings, graph]);

  return null;
}
