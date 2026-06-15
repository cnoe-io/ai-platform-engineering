// assisted-by Codex Codex-sonnet-4-6

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

function chartTaskDirectTypes(relation: string): DirectType[] {
  const model = JSON.parse(readFileSync(CHART_JSON, "utf8")) as {
    type_definitions: Array<{
      type: string;
      metadata?: {
        relations?: Record<string, { directly_related_user_types?: DirectType[] }>;
      };
    }>;
  };
  const task = model.type_definitions.find((t) => t.type === "task");
  if (!task) throw new Error("task type missing from chart JSON");
  return task.metadata?.relations?.[relation]?.directly_related_user_types ?? [];
}

function hasOrgMember(types: DirectType[]): boolean {
  return types.some((t) => t.type === "organization" && t.relation === "member");
}

function fgaTaskDefinition(relation: string): string {
  const text = readFileSync(MODEL_FGA, "utf8");
  const lines = text.split("\n");
  let inTask = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const typeMatch = /^type\s+([A-Za-z0-9_]+)\s*$/.exec(line.trim());
    if (typeMatch) {
      inTask = typeMatch[1] === "task";
      continue;
    }
    if (!inTask) continue;
    const defMatch = new RegExp(`^\\s+define\\s+${relation}\\s*:\\s*(.+)$`).exec(line);
    if (defMatch) return defMatch[1].trim();
  }
  throw new Error(`task.${relation} not found in model.fga`);
}

describe("workflow task org-wide sharing contract", () => {
  it.each(["reader", "user"])("allows organization#member as a `%s` subject in chart JSON", (relation) => {
    expect(hasOrgMember(chartTaskDirectTypes(relation))).toBe(true);
  });

  it.each(["reader", "user"])("lists organization#member in task.%s in model.fga", (relation) => {
    expect(fgaTaskDefinition(relation)).toMatch(/\borganization#member\b/);
  });

  it("does not allow organization#member to manage tasks", () => {
    expect(hasOrgMember(chartTaskDirectTypes("manager"))).toBe(false);
    expect(fgaTaskDefinition("manager")).not.toMatch(/\borganization#member\b/);
  });
});
