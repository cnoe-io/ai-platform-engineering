/**
 * Session context assembler.
 *
 * Combines:
 *   - Memory files (global + project + managed)
 *   - Git file tree (capped at 150 files)
 *   - Recent git log (last 20 commits)
 *
 * Total context is capped at 100k tokens (~400k chars).
 */

import { findRepoRoot, sampleFileTree, recentLog } from "../platform/git.js";
import { loadMemoryFiles, buildMemoryContext } from "../memory/loader.js";

const MAX_CONTEXT_CHARS = 400_000; // ~100k tokens

/**
 * Assemble the system context string for the session.
 * If `noContext` is true, only memory files are included (no git context).
 */
export async function buildSystemContext(
  cwd: string,
  noContext = false,
): Promise<string> {
  const memoryFiles = loadMemoryFiles(cwd);
  const memoryContext = buildMemoryContext(memoryFiles);

  if (noContext) {
    return memoryContext;
  }

  const repoRoot = await findRepoRoot(cwd);

  let gitSection = "";
  if (repoRoot !== null) {
    const [tree, log] = await Promise.all([
      sampleFileTree(repoRoot),
      recentLog(repoRoot),
    ]);

    gitSection =
      `<repository>\n` +
      `<root>${repoRoot}</root>\n` +
      `<file-tree>\n${tree}\n</file-tree>\n` +
      `<recent-commits>\n${log}\n</recent-commits>\n` +
      `</repository>`;
  }

  const parts = [memoryContext, gitSection].filter(Boolean);
  let combined = parts.join("\n\n");

  if (combined.length > MAX_CONTEXT_CHARS) {
    combined = combined.slice(0, MAX_CONTEXT_CHARS) + "\n... (context truncated)";
  }

  return combined;
}
