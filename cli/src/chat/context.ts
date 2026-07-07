/**
 * Session context assembler.
 *
 * Combines:
 *   - Memory files (global + project + managed)
 *   - Available agents from the server registry
 *   - Skills loaded in the supervisor
 *   - Git file tree (capped at 150 files)
 *   - Recent git log (last 20 commits)
 *
 * Total context is capped at 100k tokens (~400k chars).
 */
// assisted-by claude code claude-sonnet-4-6

import { buildMemoryContext, loadMemoryFiles } from "../memory/loader.js";
import { findRepoRoot, recentLog, sampleFileTree } from "../platform/git.js";

const MAX_CONTEXT_CHARS = 400_000; // ~100k tokens

export interface ContextExtras {
  serverUrl?: string;
  getToken?: () => Promise<string>;
}

/**
 * Assemble the system context string for the session.
 * If `noContext` is true, only memory files are included (no git/agents/skills context).
 * Pass `extras` to enable progressive agent + skill injection.
 */
export async function buildSystemContext(
  cwd: string,
  noContext = false,
  extras: ContextExtras = {},
): Promise<string> {
  const memoryFiles = loadMemoryFiles(cwd);
  const memoryContext = buildMemoryContext(memoryFiles);

  if (noContext) {
    return memoryContext;
  }

  // Fetch agents + skills in parallel with git context — all best-effort
  const [repoRoot, agentsSection, skillsSection] = await Promise.all([
    findRepoRoot(cwd),
    extras.serverUrl && extras.getToken
      ? fetchAgentsSection(extras.serverUrl, extras.getToken)
      : Promise.resolve(""),
    extras.serverUrl && extras.getToken
      ? fetchSkillsSection(extras.serverUrl, extras.getToken)
      : Promise.resolve(""),
  ]);

  let gitSection = "";
  if (repoRoot !== null) {
    const [tree, log] = await Promise.all([sampleFileTree(repoRoot), recentLog(repoRoot)]);
    gitSection = `<repository>\n<root>${repoRoot}</root>\n<file-tree>\n${tree}\n</file-tree>\n<recent-commits>\n${log}\n</recent-commits>\n</repository>`;
  }

  const parts = [memoryContext, agentsSection, skillsSection, gitSection].filter(Boolean);
  let combined = parts.join("\n\n");

  if (combined.length > MAX_CONTEXT_CHARS) {
    combined = `${combined.slice(0, MAX_CONTEXT_CHARS)}\n... (context truncated)`;
  }

  return combined;
}

// ---------------------------------------------------------------------------
// Internal helpers — best-effort, never throw
// ---------------------------------------------------------------------------

async function fetchAgentsSection(
  serverUrl: string,
  getToken: () => Promise<string>,
): Promise<string> {
  try {
    const { fetchAgents } = await import("../agents/registry.js");
    const agents = await fetchAgents(serverUrl, getToken);
    if (agents.length === 0) return "";
    const lines = agents
      .filter((a) => a.available)
      .map((a) => `- **${a.name}** (${a.domain}): ${a.description}`);
    return `<available-agents>\n${lines.join("\n")}\n</available-agents>`;
  } catch {
    return "";
  }
}

async function fetchSkillsSection(
  serverUrl: string,
  getToken: () => Promise<string>,
): Promise<string> {
  try {
    const { fetchSupervisorSkills } = await import("../skills/catalog.js");
    const { skills } = await fetchSupervisorSkills(getToken, serverUrl);
    if (skills.length === 0) return "";
    const lines = skills.map((s) => {
      const tags = s.metadata?.tags?.length ? ` [${s.metadata.tags.join(", ")}]` : "";
      return `- **${s.name}**${tags}: ${s.description}`;
    });
    return `<available-skills>\n${lines.join("\n")}\n</available-skills>`;
  } catch {
    return "";
  }
}
