/**
 * When OAuth re-consent supersedes a provider connection, pinned MCP server
 * credential_sources can still reference the disabled connection id.
 */

import { getCollection } from "@/lib/mongodb";
import type { MCPCredentialSource, MCPServerConfig } from "@/types/dynamic-agent";

import type { CredentialOwnerRef } from "./types";

function isPinnedProviderSource(source: MCPCredentialSource): boolean {
  if (source.kind !== "provider_connection") return false;
  if (source.connection_scope === "pinned") return true;
  const connectionId = source.provider_connection_id?.trim() ?? "";
  const providerKey = source.provider?.trim() ?? "";
  return Boolean(connectionId && !providerKey);
}

function relinkCredentialSources(
  sources: MCPCredentialSource[] | undefined,
  supersededIds: Set<string>,
  newConnectionId: string,
): { sources: MCPCredentialSource[]; changed: boolean } {
  if (!sources?.length) return { sources: sources ?? [], changed: false };
  let changed = false;
  const next = sources.map((source) => {
    if (!isPinnedProviderSource(source)) return source;
    const connectionId = source.provider_connection_id?.trim() ?? "";
    if (!supersededIds.has(connectionId)) return source;
    changed = true;
    return {
      ...source,
      connection_scope: "pinned" as const,
      provider_connection_id: newConnectionId,
      provider: undefined,
    };
  });
  return { sources: next, changed };
}

export async function relinkPinnedMcpCredentialSources(input: {
  owner: CredentialOwnerRef;
  supersededConnectionIds: string[];
  newConnectionId: string;
}): Promise<number> {
  const supersededIds = new Set(
    input.supersededConnectionIds.map((id) => id.trim()).filter(Boolean),
  );
  const newConnectionId = input.newConnectionId.trim();
  if (supersededIds.size === 0 || !newConnectionId) return 0;

  const collection = await getCollection<MCPServerConfig>("mcp_servers");
  const candidates = await collection
    .find({
      credential_sources: {
        $elemMatch: {
          kind: "provider_connection",
          provider_connection_id: { $in: [...supersededIds] },
        },
      },
    })
    .toArray();

  let updated = 0;
  for (const server of candidates) {
    const relinked = relinkCredentialSources(
      server.credential_sources,
      supersededIds,
      newConnectionId,
    );
    if (!relinked.changed) continue;
    await collection.updateOne(
      { _id: server._id },
      {
        $set: {
          credential_sources: relinked.sources,
          updated_at: new Date().toISOString(),
        },
      },
    );
    updated += 1;
  }
  return updated;
}
