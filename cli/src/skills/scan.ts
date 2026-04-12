/**
 * Installed skills scanner.
 *
 * Scans for skill files in priority order:
 *   1. .claude/*.md (project, preferred)
 *   2. skills/*.md  (project, fallback)
 *   3. ~/.config/caipe/skills/*.md (global)
 *
 * Each file must have YAML frontmatter with at least `name` and `version`.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { globalSkillsDir, projectClaudeDir } from "../platform/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstalledSkill {
  name: string;
  version: string;
  description: string;
  path: string;
  scope: "project" | "global";
}

// ---------------------------------------------------------------------------
// Frontmatter parser (minimal YAML subset)
// ---------------------------------------------------------------------------

/**
 * Extract YAML frontmatter from a Markdown string.
 * Returns parsed key-value pairs (strings only — sufficient for skill metadata).
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1] ?? "";
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    result[key] = val;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function scanDir(dir: string, scope: InstalledSkill["scope"]): InstalledSkill[] {
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const skills: InstalledSkill[] = [];
  for (const file of files) {
    const path = join(dir, file);
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    const name = fm["name"];
    const version = fm["version"];
    if (!name || !version) continue; // not a skill file

    skills.push({
      name,
      version,
      description: fm["description"] ?? "",
      path,
      scope,
    });
  }

  return skills;
}

/**
 * Scan all skill installation locations and return installed skills.
 * Project-scoped skills take precedence over global ones (by name).
 */
export function scanInstalledSkills(cwd: string): InstalledSkill[] {
  const projectSkills: InstalledSkill[] = [];

  // .claude/*.md (preferred project location)
  const claudeDir = projectClaudeDir(cwd);
  if (claudeDir !== null) {
    projectSkills.push(...scanDir(claudeDir, "project"));
  }

  // skills/*.md (fallback project location — only if .claude/ not present)
  if (claudeDir === null) {
    const skillsDir = join(cwd, "skills");
    projectSkills.push(...scanDir(skillsDir, "project"));
  }

  // Global skills
  const globalSkills = scanDir(globalSkillsDir(), "global");

  // Merge: project skills override global by name
  const seen = new Set(projectSkills.map((s) => s.name));
  const merged = [...projectSkills];
  for (const s of globalSkills) {
    if (!seen.has(s.name)) {
      merged.push(s);
    }
  }

  return merged;
}
