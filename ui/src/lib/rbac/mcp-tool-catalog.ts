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
  input_schema_legacy_hash?: string;
  input_schema?: Record<string, unknown>;
  eligible_policy_fields?: EligiblePolicyField[];
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
  input_schema_hash?: string;
  input_schema?: Record<string, unknown>;
  eligible_policy_fields?: EligiblePolicyField[];
}

export interface EligiblePolicyField {
  pointer: string;
  type: "string" | "integer" | "boolean";
  required: boolean;
}

export interface SanitizedMcpSchema {
  schema: Record<string, unknown>;
  schemaHash: string;
  legacyHash: string;
  eligibleFields: EligiblePolicyField[];
}

export interface CachedMcpToolCatalog {
  catalogedServerIds: Set<string>;
  toolsByServer: Map<string, CachedMcpToolItem[]>;
}

function isValidToolName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerEscape(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isSensitiveField(name: string, schema: Record<string, unknown>): boolean {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return /(^|_)(password|passwd|secret|token|credential|authorization|private_key)($|_)/.test(normalized) ||
    schema.format === "password" || schema.writeOnly === true;
}

export function sanitizeMcpInputSchema(input: unknown): SanitizedMcpSchema | undefined {
  if (!isRecord(input)) return undefined;
  let fields = 0;
  const eligibleFields: EligiblePolicyField[] = [];

  function visit(schema: Record<string, unknown>, pointer: string, required: boolean, depth: number): Record<string, unknown> | undefined {
    if (depth > 8 || fields > 64) return undefined;
    const type = schema.type;
    if (type === "string" || type === "integer" || type === "boolean") {
      fields += 1;
      if (fields > 64) return undefined;
      eligibleFields.push({ pointer, type, required });
      const result: Record<string, unknown> = { type };
      if (Array.isArray(schema.enum) && schema.enum.length <= 50) {
        const values = schema.enum.filter((value) => {
          if (type === "integer") return typeof value === "number" && Number.isInteger(value);
          return typeof value === type && (typeof value !== "string" || value.length <= 256);
        });
        if (values.length) result.enum = values;
      }
      return result;
    }
    if (type !== "object" && !isRecord(schema.properties)) return undefined;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const requiredNames = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
    const cleanProperties: Record<string, unknown> = {};
    for (const name of Object.keys(properties).sort()) {
      const child = properties[name];
      if (!isRecord(child) || isSensitiveField(name, child)) continue;
      const clean = visit(child, `${pointer}/${pointerEscape(name)}`, requiredNames.has(name), depth + 1);
      if (clean) cleanProperties[name] = clean;
    }
    const result: Record<string, unknown> = { type: "object", properties: cleanProperties };
    const cleanRequired = [...requiredNames].filter((name) => name in cleanProperties).sort();
    if (cleanRequired.length) result.required = cleanRequired;
    return result;
  }

  const schema = visit(input, "", false, 0);
  if (!schema || eligibleFields.length === 0) return undefined;
  const canonical = canonicalJson(schema);
  if (new TextEncoder().encode(canonical).length > 16_384) return undefined;
  return {
    schema,
    schemaHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    legacyHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    eligibleFields: eligibleFields.sort((left, right) => left.pointer.localeCompare(right.pointer)),
  };
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
    const sanitized = sanitizeMcpInputSchema(tool.input_schema);
    entries.push({
      _id: ref,
      server_id: serverId,
      tool_id: toolName,
      ref,
      display_name: displayNameForTool(serverId, toolName, tool),
      ...(tool.description ? { description: tool.description } : {}),
      ...(sanitized ? {
        input_schema_hash: sanitized.schemaHash,
        input_schema_legacy_hash: sanitized.legacyHash,
        input_schema: sanitized.schema,
        eligible_policy_fields: sanitized.eligibleFields,
      } : {}),
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
            input_schema_legacy_hash: entry.input_schema_legacy_hash,
            input_schema: entry.input_schema,
            eligible_policy_fields: entry.eligible_policy_fields,
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
      { projection: { server_id: 1, tool_id: 1, ref: 1, display_name: 1, description: 1, input_schema_hash: 1, input_schema: 1, eligible_policy_fields: 1, enabled: 1, kind: 1 } },
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
      ...(row.input_schema_hash ? { input_schema_hash: row.input_schema_hash } : {}),
      ...(row.input_schema ? { input_schema: row.input_schema } : {}),
      ...(row.eligible_policy_fields ? { eligible_policy_fields: row.eligible_policy_fields } : {}),
    };
    const list = toolsByServer.get(row.server_id) ?? [];
    list.push(item);
    toolsByServer.set(row.server_id, list);
  }

  return { catalogedServerIds, toolsByServer };
}
