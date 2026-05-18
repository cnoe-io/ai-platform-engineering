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
  approver: "approve",
  auditor: "audit",
  caller: "call",
  ingestor: "ingest",
  invoker: "invoke",
  manager: "manage",
  metadata_reader: "read-metadata",
  owner: "manage",
  reader: "read",
  sharer: "share",
  user: "use",
  writer: "write",
};

function nodeType(id: string): string {
  if (id.includes("#")) return "userset";
  return id.split(":", 1)[0] || "unknown";
}

function addNode(nodes: Map<string, RebacGraphNode>, id: string): void {
  if (nodes.has(id)) return;
  nodes.set(id, { id, label: id.replace("#member", " members"), type: nodeType(id) });
}

function edgeId(tuple: OpenFgaTuple): string {
  return `${tuple.key.user}:${tuple.key.relation}:${tuple.key.object}`;
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
  const scoped: Record<string, unknown> = {};
  if (filters.team) scoped.team = filters.team;
  if (filters.subject) scoped.subject = filters.subject;
  if (Object.keys(scoped).length > 0) return scoped;
  if (filters.resourceType && filters.resourceId) {
    return { resource: `${filters.resourceType}:${filters.resourceId}` };
  }
  if (filters.slackChannel) return { slack_channel: filters.slackChannel };
  return { all: true };
}

function appendTupleEdge(input: {
  tuple: OpenFgaTuple;
  nodes: Map<string, RebacGraphNode>;
  edges: RebacGraphEdge[];
  provenanceByKey: Map<string, RebacRelationshipDocument>;
  seenEdges: Set<string>;
  maxTuples: number;
}): boolean {
  if (input.edges.length >= input.maxTuples) return false;
  const id = edgeId(input.tuple);
  if (input.seenEdges.has(id)) return true;
  input.seenEdges.add(id);
  addNode(input.nodes, input.tuple.key.user);
  addNode(input.nodes, input.tuple.key.object);
  const source = input.provenanceByKey.get(tupleProvenanceKey(input.tuple));
  input.edges.push({
    id,
    from: input.tuple.key.user,
    to: input.tuple.key.object,
    relation: input.tuple.key.relation,
    timestamp: input.tuple.timestamp,
    source: source
      ? { source_type: source.source_type, source_id: source.source_id, status: source.status }
      : null,
  });
  return input.edges.length < input.maxTuples;
}

async function readTuplesForUser(user: string, maxTuples: number): Promise<OpenFgaTuple[]> {
  const tuples: OpenFgaTuple[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      tuple: { user },
      pageSize: Math.min(100, maxTuples - tuples.length),
      continuationToken,
    });
    tuples.push(...result.tuples);
    continuationToken = result.continuationToken;
  } while (continuationToken && tuples.length < maxTuples);
  return tuples;
}

async function readTuplesForSubject(subject: string, maxTuples: number): Promise<OpenFgaTuple[]> {
  if (subject !== "user:*") return readTuplesForUser(subject, maxTuples);

  const tuples: OpenFgaTuple[] = [];
  let continuationToken: string | undefined;
  let tuplesRead = 0;
  do {
    const result = await readOpenFgaTuples({
      pageSize: Math.min(100, maxTuples - tuplesRead),
      continuationToken,
    });
    tuples.push(...result.tuples.filter((tuple) => tuple.key.user === subject));
    tuplesRead += result.tuples.length;
    continuationToken = result.continuationToken;
  } while (continuationToken && tuplesRead < maxTuples && tuples.length < maxTuples);
  return tuples.slice(0, maxTuples);
}

function usersetForMembership(tuple: OpenFgaTuple): string | null {
  if (!["member", "admin"].includes(tuple.key.relation)) return null;
  if (tuple.key.object.includes("#")) return null;
  return `${tuple.key.object}#${tuple.key.relation}`;
}

export async function queryRebacGraph(filters: RebacGraphFilters = {}): Promise<RebacGraphResult> {
  const maxTuples = Math.min(Math.max(filters.limit ?? 1000, 1), 1000);
  const nodes = new Map<string, RebacGraphNode>();
  const edges: RebacGraphEdge[] = [];
  const seenEdges = new Set<string>();
  let continuationToken = filters.continuationToken;
  let tuplesRead = 0;

  const provenanceRows = await (await getRbacCollection<RebacRelationshipDocument>("rebacRelationships"))
    .find({ status: { $ne: "revoked" } })
    .sort({ created_at: -1 })
    .toArray();
  const provenanceByKey = new Map(provenanceRows.map((row) => [provenanceKey(row), row]));

  if (filters.subject) {
    const directTuples = await readTuplesForSubject(filters.subject, maxTuples);
    const subjectlessFilters = { ...filters, subject: undefined };
    const expandedUsersets = new Set<string>();
    for (const tuple of directTuples.filter((candidate) => includeTuple(candidate, subjectlessFilters))) {
      appendTupleEdge({ tuple, nodes, edges, provenanceByKey, seenEdges, maxTuples });
      const userset = usersetForMembership(tuple);
      if (userset) expandedUsersets.add(userset);
      if (edges.length >= maxTuples) break;
    }

    for (const userset of expandedUsersets) {
      if (edges.length >= maxTuples) break;
      const inheritedTuples = await readTuplesForUser(userset, maxTuples - edges.length);
      for (const tuple of inheritedTuples.filter((candidate) => includeTuple(candidate, subjectlessFilters))) {
        if (!appendTupleEdge({ tuple, nodes, edges, provenanceByKey, seenEdges, maxTuples })) break;
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
      scope: scope(filters),
      truncated: directTuples.length >= maxTuples || edges.length >= maxTuples,
    };
  }

  do {
    const result = await readOpenFgaTuples({
      pageSize: Math.min(100, maxTuples - tuplesRead),
      continuationToken,
    });
    for (const tuple of result.tuples.filter((candidate) => includeTuple(candidate, filters))) {
      if (!appendTupleEdge({ tuple, nodes, edges, provenanceByKey, seenEdges, maxTuples })) break;
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
