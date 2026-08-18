import { ApiError } from "@/lib/api-error";
import type { RebacGraphResult } from "@/lib/rbac/rebac-graph";

interface AuthzGraph {
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relation: string;
    conditional: boolean;
    condition_name?: string | null;
    policy?: {
      policy_id: string;
      status: string;
      template: string;
      field: string;
      schema_hash: string;
      version: number;
    } | null;
  }>;
  truncated: boolean;
  continuation_token?: string | null;
}

export function projectAuthzGraph(value: AuthzGraph): RebacGraphResult {
  return {
    nodes: value.nodes.map((node) => ({ id: node.id, label: node.id, type: node.type })),
    edges: value.edges.map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      relation: edge.relation,
      kind: "openfga",
      layer: "tuples",
      conditional: edge.conditional,
      condition_name: edge.condition_name ?? undefined,
      policy: edge.policy ?? undefined,
    })),
    scope: { all: true, layer: "tuples", source: "caipe-authz" },
    truncated: value.truncated,
    ...(value.continuation_token ? { continuation_token: value.continuation_token } : {}),
  };
}

export async function getAuthzGraph(limit: number): Promise<RebacGraphResult> {
  const token = process.env.AUTHZ_ADMIN_TOKEN?.trim();
  if (!token) throw new ApiError("caipe-authz admin token is not configured", 503);
  const url = (process.env.AUTHZ_SERVICE_URL ?? "http://caipe-authz:8090").replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${url}/v1/admin/graph?limit=${limit}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(Number(process.env.AUTHZ_INSPECTION_TIMEOUT_MS ?? 3000)),
    });
  } catch (error) {
    throw new ApiError(`caipe-authz inspection unavailable: ${error instanceof Error ? error.message : String(error)}`, 503);
  }
  if (!response.ok) throw new ApiError(`caipe-authz inspection returned ${response.status}`, response.status);
  return projectAuthzGraph(await response.json() as AuthzGraph);
}
