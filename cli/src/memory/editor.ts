/**
 * Memory file editor launcher (T046).
 *
 * Opens the appropriate CLAUDE.md in $EDITOR (or $VISUAL, then vi).
 * Creates the file with a starter comment if it does not exist.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execa } from "execa";
import {
  globalMemoryFile,
  globalConfigDir,
  projectClaudeDir,
} from "../platform/config.js";

const STARTER_COMMENT = `# CLAUDE.md — CAIPE Session Memory
#
# This file is loaded at the start of every caipe chat session.
# Use it to provide persistent context about your project, preferences,
# or working style.
#
# Example:
#   - I prefer concise code comments
#   - This project uses Go 1.22 and Chi router
#   - Always run tests before committing
`;

/**
 * Open the memory file for `scope` in the user's editor.
 */
export async function openMemoryFile(
  scope: "project" | "global",
  cwd: string,
): Promise<void> {
  const filePath = resolveMemoryFilePath(scope, cwd);

  // Create file if absent
  if (!existsSync(filePath)) {
    const dir = join(filePath, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, STARTER_COMMENT, "utf8");
  }

  // Resolve editor
  const editor = process.env["EDITOR"] ?? process.env["VISUAL"] ?? "vi";
  process.stdout.write(`Opening ${filePath} in ${editor}...\n`);
  process.stdout.write(`(To change editor, set $EDITOR in your shell.)\n\n`);

  await execa(editor, [filePath], { stdio: "inherit" });
}

function resolveMemoryFilePath(scope: "project" | "global", cwd: string): string {
  if (scope === "global") {
    const dir = globalConfigDir();
    mkdirSync(dir, { recursive: true });
    return globalMemoryFile();
  }

  const claudeDir = projectClaudeDir(cwd);
  if (claudeDir !== null) {
    return join(claudeDir, "CLAUDE.md");
  }

  // No .claude/ dir — create in cwd/.claude/
  const newClaudeDir = join(cwd, ".claude");
  return join(newClaudeDir, "CLAUDE.md");
}
