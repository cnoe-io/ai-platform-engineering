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
  if (id.endsWith("#member")) return "userset";
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
    const maxTuples = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "1000", 10), 1),
      1000
    );
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    let continuationToken: string | undefined;
    let tuplesRead = 0;

    do {
      const result = await readOpenFgaTuples({
        pageSize: Math.min(100, maxTuples - tuplesRead),
        continuationToken,
      });

      for (const tuple of result.tuples.filter((candidate) => includeTuple(candidate, teamSlug))) {
        if (edges.length >= maxTuples) break;
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

      tuplesRead += result.tuples.length;
      continuationToken = result.continuationToken;
    } while (continuationToken && tuplesRead < maxTuples && edges.length < maxTuples);

    return successResponse({
      nodes: Array.from(nodes.values()),
      edges,
      continuation_token: continuationToken,
      scope: teamSlug ? { team: teamSlug } : { all: true },
      truncated: Boolean(continuationToken),
    });
  })
);
