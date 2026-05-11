/**
 * tools-strings — helpers to (de)serialize the flat `allowed-tools` string
 * list stored in SKILL.md frontmatter into the structured selections used
 * by the new ToolsTab UI.
 *
 * The on-disk shape is unchanged (a plain string[] in frontmatter), so this
 * module is the only place that knows the encoding convention.
 *
 * Conventions
 * - Built-in tools are bare ids (e.g. `read`, `bash`, `web_search`).
 * - MCP tools use Claude Code style: `mcp__<serverId>__<toolName>`.
 *   A leading `mcp__` and a `__` separator distinguish the two halves.
 *   Server ids and tool names themselves may contain single underscores.
 * - Anything else is treated as a "custom" allow-listed tool string and
 *   passed through verbatim — preserves backwards compat for hand-edited
 *   SKILL.md files.
 */

const MCP_PREFIX = "mcp__";
const MCP_SEP = "__";

/** Build the canonical `mcp__<serverId>__<toolName>` allow-list entry. */
export function encodeMcpTool(serverId: string, toolName: string): string {
  return `${MCP_PREFIX}${serverId}${MCP_SEP}${toolName}`;
}

/**
 * Try to parse an allow-list entry as an MCP tool reference. Returns
 * `null` for anything that isn't `mcp__<serverId>__<toolName>`.
 */
export function decodeMcpTool(
  entry: string,
): { serverId: string; toolName: string } | null {
  if (!entry.startsWith(MCP_PREFIX)) return null;
  const rest = entry.slice(MCP_PREFIX.length);
  const sep = rest.indexOf(MCP_SEP);
  if (sep <= 0 || sep >= rest.length - MCP_SEP.length) return null;
  const serverId = rest.slice(0, sep);
  const toolName = rest.slice(sep + MCP_SEP.length);
  if (!serverId || !toolName) return null;
  return { serverId, toolName };
}

/** True iff `entry` is an MCP-encoded allow-list string. */
export function isMcpToolEntry(entry: string): boolean {
  return decodeMcpTool(entry) !== null;
}

export interface PartitionedTools {
  /** Bare ids that match a known built-in tool definition. */
  builtins: string[];
  /** MCP entries grouped by server id. */
  mcpByServer: Record<string, string[]>;
  /** Anything else — custom strings preserved verbatim. */
  custom: string[];
}

/**
 * Split a flat allow-list into the three buckets the UI renders.
 *
 * `knownBuiltinIds` is supplied by the caller because the canonical list
 * comes from `/api/dynamic-agents/builtin-tools` at runtime — we don't
 * want to hardcode it in this helper.
 */
export function partitionAllowedTools(
  allowed: string[],
  knownBuiltinIds: ReadonlySet<string>,
): PartitionedTools {
  const builtins: string[] = [];
  const mcpByServer: Record<string, string[]> = {};
  const custom: string[] = [];

  for (const entry of allowed) {
    const mcp = decodeMcpTool(entry);
    if (mcp) {
      const list = mcpByServer[mcp.serverId] ?? [];
      list.push(mcp.toolName);
      mcpByServer[mcp.serverId] = list;
      continue;
    }
    if (knownBuiltinIds.has(entry)) {
      builtins.push(entry);
      continue;
    }
    custom.push(entry);
  }

  return { builtins, mcpByServer, custom };
}

/**
 * Compose updates back to the flat list. `mcpByServer` replaces *all*
 * MCP entries; `builtins` and `custom` replace their respective buckets.
 * Order: builtins, then MCP (sorted by server id then tool), then custom.
 */
export function composeAllowedTools(
  builtins: string[],
  mcpByServer: Record<string, string[]>,
  custom: string[],
): string[] {
  const out: string[] = [];
  const dedupe = new Set<string>();

  const push = (v: string) => {
    if (dedupe.has(v)) return;
    dedupe.add(v);
    out.push(v);
  };

  for (const id of builtins) push(id);

  const serverIds = Object.keys(mcpByServer).sort();
  for (const serverId of serverIds) {
    const tools = [...(mcpByServer[serverId] ?? [])].sort();
    for (const tool of tools) push(encodeMcpTool(serverId, tool));
  }

  for (const c of custom) push(c);

  return out;
}
