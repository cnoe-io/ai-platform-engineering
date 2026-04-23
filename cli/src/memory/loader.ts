/**
 * Memory file loader.
 *
 * Loads Markdown memory files in scope order:
 *   1. Global:  ~/.config/caipe/CLAUDE.md
 *   2. Project: <nearest-ancestor>/.claude/CLAUDE.md
 *   3. Managed: <nearest-ancestor>/.claude/memory/*.md (alphabetical)
 *
 * Enforces a 50k token budget cap across all files combined.
 * Files that push the total over budget are truncated with a warning.
 *
 * Token estimation: rough approximation of 1 token ≈ 4 chars.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { globalMemoryFile, projectClaudeDir } from "../platform/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryFile {
  path: string;
  scope: "global" | "project" | "managed";
  content: string;
  tokenEstimate: number;
}

// 1 token ≈ 4 chars (rough approximation)
const CHARS_PER_TOKEN = 4;
const MAX_TOKENS = 50_000;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load all applicable memory files for the given working directory.
 * Returns the list in order; each entry has its content possibly truncated.
 */
export function loadMemoryFiles(cwd: string): MemoryFile[] {
  const files: MemoryFile[] = [];
  let totalChars = 0;

  function addFile(path: string, scope: MemoryFile["scope"]): void {
    if (!existsSync(path)) return;
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      return;
    }

    const remaining = MAX_CHARS - totalChars;
    if (remaining <= 0) {
      process.stderr.write(`[WARNING] Memory budget exhausted — skipping ${path}\n`);
      return;
    }

    if (content.length > remaining) {
      process.stderr.write(`[WARNING] Memory file ${path} truncated to fit 50k token budget.\n`);
      content = `${content.slice(0, remaining)}\n... (truncated)`;
    }

    totalChars += content.length;
    files.push({ path, scope, content, tokenEstimate: estimateTokens(content) });
  }

  // 1. Global
  addFile(globalMemoryFile(), "global");

  // 2. Project .claude/CLAUDE.md
  const claudeDir = projectClaudeDir(cwd);
  if (claudeDir !== null) {
    addFile(join(claudeDir, "CLAUDE.md"), "project");

    // 3. Managed: .claude/memory/*.md (alphabetical)
    const managedDir = join(claudeDir, "memory");
    if (existsSync(managedDir)) {
      let managedFiles: string[];
      try {
        managedFiles = readdirSync(managedDir)
          .filter((f) => f.endsWith(".md"))
          .sort();
      } catch {
        managedFiles = [];
      }
      for (const f of managedFiles) {
        addFile(join(managedDir, f), "managed");
      }
    }
  }

  return files;
}

/**
 * Concatenate all memory file contents into a single context string.
 */
export function buildMemoryContext(files: MemoryFile[]): string {
  if (files.length === 0) return "";
  return files.map((f) => `<!-- memory:${f.scope}:${f.path} -->\n${f.content}`).join("\n\n");
}
