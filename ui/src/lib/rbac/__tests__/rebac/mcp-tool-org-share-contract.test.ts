/**
 * Authorization-model contract for org-wide MCP-tool sharing
 * (spec 2026-06-03-unified-shareable-resource-rbac, US6 follow-up).
 *
 * Org-wide sharing works by granting `organization:<org>#member` the
 * reader/user/caller relations on an `mcp_tool`. OpenFGA rejects a tuple whose
 * subject type isn't an allowed `directly_related_user_type` for the relation,
 * so the model MUST list `organization#member` on those three relations (and
 * `agent` on `caller`, for agent-initiated invocation).
 *
 * This pairs with `shareable-type-drift.test.ts`: that file guards the
 * shareable shape generally; this one pins the specific subject types org-wide
 * sharing and agent invocation depend on, in BOTH the authored `.fga` and the
 * deployed chart JSON, so they can't silently drift apart.
 * assisted-by Cursor claude-opus-4-8
 */

import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");
const MODEL_FGA = join(REPO_ROOT, "deploy", "openfga", "model.fga");
const CHART_JSON = join(
  REPO_ROOT,
  "charts",
  "ai-platform-engineering",
  "charts",
  "openfga",
  "authorization-model.json",
);

interface DirectType {
  type: string;
  relation?: string;
}

/** directly_related_user_types for `mcp_tool.<relation>` in the chart JSON. */
function chartDirectTypes(relation: string): DirectType[] {
  const model = JSON.parse(readFileSync(CHART_JSON, "utf8")) as {
    type_definitions: Array<{
      type: string;
      metadata?: {
        relations?: Record<string, { directly_related_user_types?: DirectType[] }>;
      };
    }>;
  };
  const mcpTool = model.type_definitions.find((t) => t.type === "mcp_tool");
  if (!mcpTool) throw new Error("mcp_tool type missing from chart JSON");
  return mcpTool.metadata?.relations?.[relation]?.directly_related_user_types ?? [];
}

function hasOrgMember(types: DirectType[]): boolean {
  return types.some((t) => t.type === "organization" && t.relation === "member");
}

/** Raw definition expression (right of the colon) for `mcp_tool.<relation>`. */
function fgaMcpToolDefinition(relation: string): string {
  const text = readFileSync(MODEL_FGA, "utf8");
  const lines = text.split("\n");
  let inMcpTool = false;
  for (const rawLine of lines) {
    // NOTE: do NOT strip `#` as a comment delimiter — relation references such
    // as `team#member` / `organization#member` use `#` and would be truncated.
    const line = rawLine.trimEnd();
    const typeMatch = /^type\s+([A-Za-z0-9_]+)\s*$/.exec(line.trim());
    if (typeMatch) {
      inMcpTool = typeMatch[1] === "mcp_tool";
      continue;
    }
    if (!inMcpTool) continue;
    const defMatch = new RegExp(`^\\s+define\\s+${relation}\\s*:\\s*(.+)$`).exec(line);
    if (defMatch) return defMatch[1].trim();
  }
  throw new Error(`mcp_tool.${relation} not found in model.fga`);
}

describe("mcp_tool org-wide sharing contract (chart JSON)", () => {
  it.each(["reader", "user", "caller"])(
    "allows organization#member as a subject for `%s`",
    (relation) => {
      expect(hasOrgMember(chartDirectTypes(relation))).toBe(true);
    },
  );

  it("allows an `agent` subject on `caller` (agent-initiated invocation)", () => {
    const types = chartDirectTypes("caller");
    expect(types.some((t) => t.type === "agent" && t.relation === undefined)).toBe(true);
  });

  it("does NOT add organization#member to `manager` (org members can't manage)", () => {
    expect(hasOrgMember(chartDirectTypes("manager"))).toBe(false);
  });
});

describe("mcp_tool org-wide sharing contract (authored model.fga)", () => {
  it.each(["reader", "user", "caller"])(
    "lists organization#member in the `%s` definition",
    (relation) => {
      expect(fgaMcpToolDefinition(relation)).toMatch(/\borganization#member\b/);
    },
  );

  it("lists `agent` in the `caller` definition", () => {
    expect(fgaMcpToolDefinition("caller")).toMatch(/\bagent\b/);
  });
});
