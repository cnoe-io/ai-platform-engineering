import { ApiError } from "@/lib/api-error";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";
import { webexSpaceSubjectId } from "@/lib/rbac/webex-space-grant-store";

import { webexBotInstallationUser } from "./webex-bot-openfga";

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

async function listOpenFgaAgentIds(user: string): Promise<string[]> {
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

/** Read pre-multi-bot route tuples. Used only by the explicit migration flow. */
export function listOpenFgaWebexSpaceAgentIds(
  workspaceId: string,
  spaceId: string,
): Promise<string[]> {
  return listOpenFgaAgentIds(webexSpaceOpenFgaUser(workspaceId, spaceId));
}

export function listOpenFgaWebexBotAgentIds(
  botId: string,
  workspaceId: string,
  spaceId: string,
): Promise<string[]> {
  return listOpenFgaAgentIds(webexBotInstallationUser(botId, workspaceId, spaceId));
}
