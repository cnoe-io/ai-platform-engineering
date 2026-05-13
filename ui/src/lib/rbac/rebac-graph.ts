import { getRbacCollection, type RebacRelationshipDocument } from "./mongo-collections";
import { readOpenFgaTuples, type OpenFgaTuple } from "./openfga";

export interface RebacGraphFilters {
  team?: string;
  subject?: string;
  resourceType?: string;
  resourceId?: string;
  slackChannel?: string;
  limit?: number;
  continuationToken?: string;
}

export interface RebacGraphNode {
  id: string;
  label: string;
  type: string;
}

export interface RebacGraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  source?: {
    source_type: RebacRelationshipDocument["source_type"];
    source_id?: string;
    status: RebacRelationshipDocument["status"];
  } | null;
  timestamp?: string;
}

export interface RebacGraphResult {
  nodes: RebacGraphNode[];
  edges: RebacGraphEdge[];
  scope: Record<string, unknown>;
  continuation_token?: string;
  truncated: boolean;
}

const RELATION_TO_ACTION: Record<string, string> = {
  can_admin: "administer",
  can_audit: "audit",
  can_call: "call",
  can_create: "create",
  can_delete: "delete",
  can_discover: "discover",
  can_ingest: "ingest",
  can_invoke: "invoke",
  can_manage: "manage",
  can_map: "map",
  can_read: "read",
  can_read_metadata: "read-metadata",
  can_share: "share",
  can_use: "use",
  can_write: "write",
};

function nodeType(id: string): string {
  if (id.includes("#")) return "userset";
  return id.split(":", 1)[0] || "unknown";
}

function addNode(nodes: Map<string, RebacGraphNode>, id: string): void {
  if (nodes.has(id)) return;
  nodes.set(id, { id, label: id.replace("#member", " members"), type: nodeType(id) });
}

function includeTuple(tuple: OpenFgaTuple, filters: RebacGraphFilters): boolean {
  if (filters.team) {
    const teamRef = `team:${filters.team}`;
    if (tuple.key.user !== `${teamRef}#member` && tuple.key.object !== teamRef) return false;
  }
  if (filters.subject && tuple.key.user !== filters.subject) return false;
  if (filters.resourceType && filters.resourceId && tuple.key.object !== `${filters.resourceType}:${filters.resourceId}`) {
    return false;
  }
  if (filters.slackChannel) {
    const channelRef = `slack_channel:${filters.slackChannel}`;
    if (tuple.key.user !== channelRef && tuple.key.object !== channelRef) return false;
  }
  return true;
}

function provenanceKey(row: RebacRelationshipDocument): string {
  return `${row.subject.type}:${row.subject.id}#${row.subject.relation ?? ""}:${row.action}:${row.resource.type}:${row.resource.id}`;
}

function tupleProvenanceKey(tuple: OpenFgaTuple): string {
  const [subjectType, subjectRest = ""] = tuple.key.user.split(":", 2);
  const [subjectId, subjectRelation = ""] = subjectRest.split("#", 2);
  const [resourceType, resourceId = ""] = tuple.key.object.split(":", 2);
  return `${subjectType}:${subjectId}#${subjectRelation}:${RELATION_TO_ACTION[tuple.key.relation] ?? tuple.key.relation}:${resourceType}:${resourceId}`;
}

function scope(filters: RebacGraphFilters): Record<string, unknown> {
  if (filters.team) return { team: filters.team };
  if (filters.subject) return { subject: filters.subject };
  if (filters.resourceType && filters.resourceId) {
    return { resource: `${filters.resourceType}:${filters.resourceId}` };
  }
  if (filters.slackChannel) return { slack_channel: filters.slackChannel };
  return { all: true };
}

export async function queryRebacGraph(filters: RebacGraphFilters = {}): Promise<RebacGraphResult> {
  const maxTuples = Math.min(Math.max(filters.limit ?? 1000, 1), 1000);
  const nodes = new Map<string, RebacGraphNode>();
  const edges: RebacGraphEdge[] = [];
  let continuationToken = filters.continuationToken;
  let tuplesRead = 0;

  const provenanceRows = await (await getRbacCollection<RebacRelationshipDocument>("rebacRelationships"))
    .find({ status: { $ne: "revoked" } })
    .sort({ created_at: -1 })
    .toArray();
  const provenanceByKey = new Map(provenanceRows.map((row) => [provenanceKey(row), row]));

  do {
    const result = await readOpenFgaTuples({
      pageSize: Math.min(100, maxTuples - tuplesRead),
      continuationToken,
    });
    for (const tuple of result.tuples.filter((candidate) => includeTuple(candidate, filters))) {
      if (edges.length >= maxTuples) break;
      addNode(nodes, tuple.key.user);
      addNode(nodes, tuple.key.object);
      const source = provenanceByKey.get(tupleProvenanceKey(tuple));
      edges.push({
        id: `${tuple.key.user}:${tuple.key.relation}:${tuple.key.object}`,
        from: tuple.key.user,
        to: tuple.key.object,
        relation: tuple.key.relation,
        timestamp: tuple.timestamp,
        source: source
          ? { source_type: source.source_type, source_id: source.source_id, status: source.status }
          : null,
      });
    }
    tuplesRead += result.tuples.length;
    continuationToken = result.continuationToken;
  } while (continuationToken && tuplesRead < maxTuples && edges.length < maxTuples);

  return {
    nodes: Array.from(nodes.values()),
    edges,
    scope: scope(filters),
    continuation_token: continuationToken,
    truncated: Boolean(continuationToken),
  };
}
