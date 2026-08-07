/**
 * `caipe init` — bootstrap project memory files.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { globalConfigDir, globalMemoryFile, projectClaudeDir } from "../platform/config.js";

const STARTER = `# CLAUDE.md — CAIPE Session Memory
#
# Loaded at the start of every \`caipe chat\` session in this project.
# Add conventions, stack notes, and preferences for the agent.
`;

export async function runInit(opts: { global?: boolean }): Promise<void> {
  if (opts.global) {
    const path = globalMemoryFile();
    mkdirSync(globalConfigDir(), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, STARTER, "utf8");
      process.stdout.write(`Created ${path}\n`);
    } else {
      process.stdout.write(`Already exists: ${path}\n`);
    }
    return;
  }

  const cwd = process.cwd();
  const claudeDir = projectClaudeDir(cwd) ?? join(cwd, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const path = join(claudeDir, "CLAUDE.md");
  if (!existsSync(path)) {
    writeFileSync(path, STARTER, "utf8");
    process.stdout.write(`Created ${path}\n`);
  } else {
    process.stdout.write(`Already exists: ${path}\n`);
  }
}
