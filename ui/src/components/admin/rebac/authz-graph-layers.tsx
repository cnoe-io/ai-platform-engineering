"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, GitCompareArrows, History, Loader2, Route, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RebacGraphResult } from "@/lib/rbac/rebac-graph";
import type { AuditEventType, UnifiedAuditEvent } from "@/lib/rbac/types";

const HISTORY_TYPES: AuditEventType[] = [
  "authz_policy_change",
  "authz_relationship_change",
  "authz_migration_comparison",
  "authz_migration_revision",
];

interface HistoryResponse {
  records?: UnifiedAuditEvent[];
}

export function AuthzGraphLayers({ graph }: { graph: Pick<RebacGraphResult, "nodes" | "edges"> }) {
  const [events, setEvents] = useState<UnifiedAuditEvent[]>([]);
  const [inspectionGraph, setInspectionGraph] = useState<Pick<RebacGraphResult, "nodes" | "edges">>({
    nodes: [],
    edges: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const eventRequests = HISTORY_TYPES.map(async (type) => {
      const params = new URLSearchParams({ window: "24h", limit: "200", type });
      const response = await fetch(`/api/admin/audit-events?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Audit history returned ${response.status}`);
      return (await response.json()) as HistoryResponse;
    });
    const graphRequest = fetch("/api/admin/openfga/graph?layer=tuples&limit=1000", {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Authorization graph returned ${response.status}`);
      const payload = await response.json() as Pick<RebacGraphResult, "nodes" | "edges"> & {
        data?: Pick<RebacGraphResult, "nodes" | "edges">;
      };
      return payload.data ?? payload;
    });
    Promise.all([Promise.all(eventRequests), graphRequest])
      .then(([responses, currentGraph]) => {
        const merged = responses.flatMap((response) => response.records ?? []);
        setEvents(merged.sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts)));
        setInspectionGraph(currentGraph);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Failed to load authorization history");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const nodeIds = useMemo(() => new Set(graph.nodes.map((node) => node.id)), [graph.nodes]);
  const conditionalEdges = useMemo(() => {
    const selected = [...graph.edges, ...inspectionGraph.edges].filter((edge) =>
      edge.conditional && (nodeIds.size === 0 || nodeIds.has(edge.from) || nodeIds.has(edge.to)),
    );
    return [...new Map(selected.map((edge) => [edge.id, edge])).values()];
  }, [graph.edges, inspectionGraph.edges, nodeIds]);
  const history = events.filter((event) =>
    ["authz_policy_change", "authz_relationship_change"].includes(event.type)
    && (!event.resource_ref || nodeIds.has(event.resource_ref)),
  );
  const comparisons = events.filter((event) => event.type === "authz_migration_comparison");
  const revisions = events.filter((event) => event.type === "authz_migration_revision");

  return (
    <Card data-testid="authz-graph-layers">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Authorization layers
        </CardTitle>
        <CardDescription>
          Current OpenFGA state and sanitized historical evidence are separate views. Argument values are never included.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading audit overlays
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        ) : (
          <Tabs defaultValue="expressions">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="expressions">Expressions ({conditionalEdges.length})</TabsTrigger>
              <TabsTrigger value="history">History ({history.length})</TabsTrigger>
              <TabsTrigger value="comparisons">Comparisons ({comparisons.length})</TabsTrigger>
              <TabsTrigger value="revisions">Revisions ({revisions.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="expressions" className="mt-3 space-y-2">
              {conditionalEdges.length === 0 ? <Empty>No conditional relationship is visible in this graph.</Empty> : conditionalEdges.map((edge) => (
                <div key={edge.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Route className="h-4 w-4 text-muted-foreground" />
                    <code>{edge.from}</code>
                    <span className="text-muted-foreground">{edge.relation}</span>
                    <code>{edge.to}</code>
                    <Badge variant="outline">{edge.condition_name ?? "conditional"}</Badge>
                    {edge.policy?.schema_drift && <Badge variant="destructive">schema drift</Badge>}
                    {edge.policy?.exclusive && <Badge variant="secondary">exclusive</Badge>}
                  </div>
                  {edge.policy && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {edge.policy.policy_id} v{edge.policy.version} · {edge.policy.status} · field {edge.policy.field}
                    </div>
                  )}
                  {edge.policy?.shadow_warnings?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {edge.policy.shadow_warnings.map((warning) => (
                        <Badge key={warning} variant="destructive">shadowed: {warning}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </TabsContent>

            <TabsContent value="history" className="mt-3 space-y-2">
              {history.length === 0 ? <Empty>No policy or relationship history in the selected window.</Empty> : history.map((event) => (
                <EventRow key={event.audit_event_id ?? `${event.type}-${event.correlation_id}-${event.ts}`} event={event}>
                  <History className="h-4 w-4" />
                  <span>{event.type === "authz_policy_change" ? "Policy" : "Relationship"}</span>
                  <Badge variant="outline">{event.operation ?? event.action}</Badge>
                  <code>{event.resource_ref ?? "resource not reported"}</code>
                  {event.policy_id && <span>{event.policy_id}</span>}
                  {event.after_revision != null && <span>revision {event.after_revision}</span>}
                  {event.condition_name && <Badge variant="secondary">{event.condition_name}</Badge>}
                </EventRow>
              ))}
            </TabsContent>

            <TabsContent value="comparisons" className="mt-3 space-y-2">
              {comparisons.length === 0 ? <Empty>No migration comparisons in the selected window.</Empty> : comparisons.map((event) => (
                <EventRow key={event.audit_event_id ?? `comparison-${event.correlation_id}-${event.ts}`} event={event}>
                  <GitCompareArrows className="h-4 w-4" />
                  <Badge variant="outline">{event.authoritative_path ?? "unknown authority"}</Badge>
                  <Badge variant={event.mismatch_class === "NONE" ? "secondary" : "destructive"}>
                    {event.mismatch_class ?? "not classified"}
                  </Badge>
                  <span>legacy {event.legacy_outcome ?? "unknown"}</span>
                  <span>authz {event.authz_outcome ?? "unknown"}</span>
                  {event.rollout_revision && <span>{event.rollout_revision}</span>}
                </EventRow>
              ))}
            </TabsContent>

            <TabsContent value="revisions" className="mt-3 space-y-2">
              {revisions.length === 0 ? <Empty>No rollout revisions in the selected window.</Empty> : revisions.map((event) => (
                <EventRow key={event.audit_event_id ?? `revision-${event.correlation_id}-${event.ts}`} event={event}>
                  <Route className="h-4 w-4" />
                  <strong>{event.rollout_revision ?? "revision not reported"}</strong>
                  <Badge variant="outline">default {event.default_mode ?? "unknown"}</Badge>
                  <span>{event.scopes?.length ?? 0} scoped override(s)</span>
                </EventRow>
              ))}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{children}</div>;
}

function EventRow({ event, children }: { event: UnifiedAuditEvent; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
      {children}
      <time className="ml-auto text-xs text-muted-foreground" dateTime={event.ts}>
        {new Date(event.ts).toLocaleString()}
      </time>
    </div>
  );
}
