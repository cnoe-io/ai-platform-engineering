import { NextRequest } from "next/server";
import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { readOpenFgaTuples, type OpenFgaTuple } from "@/lib/rbac/openfga";
import { withOpenFgaViewAuth } from "../_lib";

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

function nodeType(id: string): string {
  const type = id.split(":", 1)[0];
  if (id.endsWith("#member")) return "team_members";
  return type || "unknown";
}

function addNode(nodes: Map<string, GraphNode>, id: string): void {
  if (nodes.has(id)) return;
  nodes.set(id, {
    id,
    label: id.replace("#member", " members"),
    type: nodeType(id),
  });
}

function includeTuple(tuple: OpenFgaTuple, teamSlug: string | null): boolean {
  if (!teamSlug) return true;
  const teamRef = `team:${teamSlug}`;
  return tuple.key.user === `${teamRef}#member` || tuple.key.object === teamRef;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const teamSlug = request.nextUrl.searchParams.get("team")?.trim() || null;
    const limit = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "200", 10), 1),
      200
    );
    const result = await readOpenFgaTuples({ pageSize: limit });
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    for (const tuple of result.tuples.filter((candidate) => includeTuple(candidate, teamSlug))) {
      const source = tuple.key.user;
      const target = tuple.key.object;
      addNode(nodes, source);
      addNode(nodes, target);
      edges.push({
        id: `${source}:${tuple.key.relation}:${target}`,
        from: source,
        to: target,
        relation: tuple.key.relation,
      });
    }

    return successResponse({
      nodes: Array.from(nodes.values()),
      edges,
      continuation_token: result.continuationToken,
    });
  })
);
