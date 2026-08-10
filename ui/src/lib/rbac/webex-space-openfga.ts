import { ApiError } from "@/lib/api-middleware";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";
import { webexSpaceSubjectId } from "@/lib/rbac/webex-space-grant-store";

const MAX_ID_LENGTH = 128;
const ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function parseWebexSpaceRouteParams(
  workspaceId: string,
  spaceId: string
): { workspaceId: string; spaceId: string } {
  const ws = workspaceId?.trim() ?? "";
  const sp = spaceId?.trim() ?? "";
  if (!ws || ws.length > MAX_ID_LENGTH || !ID_PATTERN.test(ws)) {
    throw new ApiError("Invalid workspaceId", 400);
  }
  if (!sp || sp.length > MAX_ID_LENGTH || !ID_PATTERN.test(sp)) {
    throw new ApiError("Invalid spaceId", 400);
  }
  return { workspaceId: ws, spaceId: sp };
}

export function webexSpaceOpenFgaUser(workspaceId: string, spaceId: string): string {
  return `webex_space:${webexSpaceSubjectId(workspaceId, spaceId)}`;
}

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  const agentId = object.slice("agent:".length).trim();
  return agentId || null;
}

export async function listOpenFgaWebexSpaceAgentIds(
  workspaceId: string,
  spaceId: string
): Promise<string[]> {
  const user = webexSpaceOpenFgaUser(workspaceId, spaceId);
  const seen = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      tuple: { user, relation: "user", object: "agent:" },
      pageSize: 100,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const tuple of result.tuples) {
      const agentId = agentIdFromObject(tuple.key.object);
      if (agentId) seen.add(agentId);
    }
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return Array.from(seen).sort();
}
