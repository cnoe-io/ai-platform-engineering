/**
 * Skill installer.
 *
 * Install resolution order:
 *   1. .claude/ if it exists (project, preferred)
 *   2. skills/ relative to project root (fallback)
 *   3. ~/.config/caipe/skills/ (global, requires --global flag)
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { fetchCatalog, verifyChecksum, type CatalogEntry } from "./catalog.js";
import { scanInstalledSkills } from "./scan.js";
import {
  globalSkillsDir,
  projectClaudeDir,
} from "../platform/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallOpts {
  global?: boolean;
  target?: string;
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Install a named skill from the catalog.
 */
export async function installSkill(name: string, opts: InstallOpts): Promise<void> {
  const cwd = process.cwd();

  // 1. Resolve catalog entry
  const catalog = await fetchCatalog();
  const entry = catalog.skills.find((s) => s.name === name);
  if (!entry) {
    process.stderr.write(`[ERROR] Skill "${name}" not found in catalog.\n`);
    process.stderr.write(`  Run \`caipe skills list\` to see available skills.\n`);
    process.exit(1);
  }

  // 2. Resolve target directory
  const targetDir = resolveTargetDir(cwd, opts);

  // 3. Check if already installed
  const existing = scanInstalledSkills(cwd).find((s) => s.name === name);
  if (existing && !opts.force) {
    process.stderr.write(
      `[WARNING] Skill "${name}" is already installed at ${existing.path}.\n` +
        `  Use --force to overwrite.\n`,
    );
    process.exit(3);
  }

  // 4. Fetch skill content
  const content = await fetchSkillContent(entry);

  // 5. Verify checksum
  verifyChecksum(content, entry.checksum);

  // 6. Write file
  mkdirSync(targetDir, { recursive: true });
  const destPath = join(targetDir, `${name}.md`);
  writeFileSync(destPath, content, "utf8");

  process.stdout.write(`Installed skill "${name}" → ${destPath}\n`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTargetDir(cwd: string, opts: InstallOpts): string {
  if (opts.target) return opts.target;
  if (opts.global) return globalSkillsDir();

  const claudeDir = projectClaudeDir(cwd);
  if (claudeDir !== null) return claudeDir;

  // No .claude/ — fall back to skills/ in project root
  const projectRoot = findProjectRoot(cwd);
  if (projectRoot !== null) return join(projectRoot, "skills");

  // Not in a git repo and --global not set
  process.stderr.write(
    "[ERROR] No .claude/ directory found and not in a git repo. " +
      "Use --global to install globally or --target to specify a directory.\n",
  );
  process.exit(1);
}

function findProjectRoot(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

async function fetchSkillContent(entry: CatalogEntry): Promise<string> {
  const res = await fetch(entry.url);
  if (!res.ok) {
    throw new Error(`Failed to fetch skill "${entry.name}": HTTP ${res.status}`);
  }
  return res.text();
}
