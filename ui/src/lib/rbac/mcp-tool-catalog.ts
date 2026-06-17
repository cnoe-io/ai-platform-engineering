// assisted-by Codex Codex-sonnet-4-6
import { createHash } from "crypto";

import { getCollection } from "@/lib/mongodb";
import type { MCPToolInfo } from "@/types/dynamic-agent";

export const MCP_TOOL_CATALOG_COLLECTION = "mcp_tool_catalog";
const CATALOG_MARKER_TOOL_ID = "__catalog_marker__";

export interface McpToolCatalogEntry {
  _id: string;
  server_id: string;
  tool_id: string;
  ref: string;
  display_name: string;
  description?: string;
  input_schema_hash?: string;
  enabled: boolean;
  kind?: "tool" | "server_catalog";
  source: "probe" | "agentgateway" | "static";
  discovered_at: string;
  last_seen_at: string;
}

export interface CachedMcpToolItem {
  server_id: string;
  tool_id: string;
  ref: string;
  name: string;
  description?: string;
}

export interface CachedMcpToolCatalog {
  catalogedServerIds: Set<string>;
  toolsByServer: Map<string, CachedMcpToolItem[]>;
}

function isValidToolName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function hashSchema(schema: unknown): string | undefined {
  if (schema === undefined || schema === null) return undefined;
  return createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

function displayNameForTool(serverId: string, toolName: string, tool: Partial<MCPToolInfo>): string {
  const label = tool.namespaced_name || tool.name || toolName;
  return label.includes("/") ? label : `${serverId}: ${label}`;
}

function toToolName(serverId: string, tool: Partial<MCPToolInfo>): string | null {
  const raw = tool.name || tool.namespaced_name;
  if (!raw) return null;
  const name = raw.startsWith(`${serverId}/`) ? raw.slice(serverId.length + 1) : raw;
  return isValidToolName(name) ? name : null;
}

function catalogMarker(serverId: string, source: McpToolCatalogEntry["source"], now: string): McpToolCatalogEntry {
  const ref = `${serverId}/${CATALOG_MARKER_TOOL_ID}`;
  return {
    _id: ref,
    server_id: serverId,
    tool_id: CATALOG_MARKER_TOOL_ID,
    ref,
    display_name: `${serverId}: catalog discovered`,
    enabled: false,
    kind: "server_catalog",
    source,
    discovered_at: now,
    last_seen_at: now,
  };
}

export async function cacheMcpToolCatalog(input: {
  serverId: string;
  tools: Array<Partial<MCPToolInfo> & { input_schema?: unknown }>;
  source?: McpToolCatalogEntry["source"];
  now?: Date;
}): Promise<number> {
  const serverId = input.serverId.trim();
  if (!isValidToolName(serverId)) return 0;

  const now = (input.now ?? new Date()).toISOString();
  const source = input.source ?? "probe";
  const entries: McpToolCatalogEntry[] = [];
  for (const tool of input.tools) {
    const toolName = toToolName(serverId, tool);
    if (!toolName) continue;
    const ref = `${serverId}/${toolName}`;
    const inputSchemaHash = hashSchema(tool.input_schema);
    entries.push({
      _id: ref,
      server_id: serverId,
      tool_id: toolName,
      ref,
      display_name: displayNameForTool(serverId, toolName, tool),
      ...(tool.description ? { description: tool.description } : {}),
      ...(inputSchemaHash ? { input_schema_hash: inputSchemaHash } : {}),
      enabled: true,
      kind: "tool",
      source,
      discovered_at: now,
      last_seen_at: now,
    });
  }

  const collection = await getCollection<McpToolCatalogEntry>(MCP_TOOL_CATALOG_COLLECTION);
  await collection.updateMany({ server_id: serverId } as never, { $set: { enabled: false } } as never);
  const writes = [catalogMarker(serverId, source, now), ...entries];

  await collection.bulkWrite(
    writes.map((entry) => ({
      updateOne: {
        filter: { _id: entry._id },
        update: {
          $set: {
            server_id: entry.server_id,
            tool_id: entry.tool_id,
            ref: entry.ref,
            display_name: entry.display_name,
            description: entry.description,
            input_schema_hash: entry.input_schema_hash,
            enabled: entry.enabled,
            kind: entry.kind ?? "tool",
            source: entry.source,
            last_seen_at: entry.last_seen_at,
          },
          $setOnInsert: { discovered_at: entry.discovered_at },
        },
        upsert: true,
      },
    })) as never,
  );

  return entries.length;
}

export async function listCachedMcpTools(serverIds: string[]): Promise<CachedMcpToolCatalog> {
  const validServerIds = [...new Set(serverIds.filter(isValidToolName))];
  const catalogedServerIds = new Set<string>();
  const toolsByServer = new Map<string, CachedMcpToolItem[]>();
  if (validServerIds.length === 0) return { catalogedServerIds, toolsByServer };

  const collection = await getCollection<McpToolCatalogEntry>(MCP_TOOL_CATALOG_COLLECTION);
  const rows = await collection
    .find(
      { server_id: { $in: validServerIds } } as never,
      { projection: { server_id: 1, tool_id: 1, ref: 1, display_name: 1, description: 1, enabled: 1, kind: 1 } },
    )
    .sort({ server_id: 1, display_name: 1 })
    .toArray();

  for (const row of rows) {
    if (row.kind === "server_catalog") {
      catalogedServerIds.add(row.server_id);
      continue;
    }
    if (row.enabled !== true) continue;
    const item: CachedMcpToolItem = {
      server_id: row.server_id,
      tool_id: row.tool_id,
      ref: row.ref,
      name: row.display_name,
      ...(row.description ? { description: row.description } : {}),
    };
    const list = toolsByServer.get(row.server_id) ?? [];
    list.push(item);
    toolsByServer.set(row.server_id, list);
  }

  return { catalogedServerIds, toolsByServer };
}
