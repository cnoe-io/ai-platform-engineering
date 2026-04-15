/**
 * CAIPE server agent registry client (T033).
 *
 * Fetches agents from GET <serverUrl>/api/v1/agents.
 * Cache: ~/.config/caipe/agents-cache.json (5-minute TTL).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { agentsCachePath, authEndpoints, globalConfigDir } from "../platform/config.js";
import type { Agent } from "./types.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedAgents {
  agents: Agent[];
  cachedAt: string;
}

export interface ValidationResult {
  valid: boolean;
  supported: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the list of available agents from the CAIPE server.
 * Uses 5-minute cache; stale cache returned on network error.
 */
export async function fetchAgents(
  serverUrl: string,
  getToken: () => Promise<string>,
): Promise<Agent[]> {
  const cached = readCache();
  if (cached && Date.now() - Date.parse(cached.cachedAt) < CACHE_TTL_MS) {
    return cached.agents;
  }

  try {
    const ep = authEndpoints(serverUrl);
    const token = await getToken();
    const res = await fetch(ep.agents, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const agents = (await res.json()) as Agent[];
    writeCache(agents);
    return agents;
  } catch (err) {
    if (cached) {
      process.stderr.write(
        `[WARNING] Could not reach agents registry (${String(err)}). Using cached list.\n`,
      );
      return cached.agents;
    }
    throw new Error(`Agents registry unavailable: ${String(err)}`);
  }
}

/**
 * Find an agent by name in the cached/fetched list.
 */
export function getAgent(agents: Agent[], name: string): Agent | null {
  return agents.find((a) => a.name === name) ?? null;
}

/**
 * Check availability flag from the agent object.
 */
export function checkAvailability(agent: Agent): boolean {
  return agent.available;
}

/**
 * Validate that `requestedProtocol` is supported by `agent`.
 *
 * If the agent has no `protocols` field, assumes A2A and returns valid for a2a.
 */
export function validateProtocol(agent: Agent, requestedProtocol: string): ValidationResult {
  const supported = agent.protocols?.length > 0 ? agent.protocols : ["a2a"];

  if ((supported as string[]).includes(requestedProtocol)) {
    return { valid: true, supported: supported as string[] };
  }

  return { valid: false, supported: supported as string[] };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function readCache(): CachedAgents | null {
  const path = agentsCachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedAgents;
  } catch {
    return null;
  }
}

function writeCache(agents: Agent[]): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cached: CachedAgents = { agents, cachedAt: new Date().toISOString() };
  writeFileSync(agentsCachePath(), `${JSON.stringify(cached, null, 2)}\n`, "utf8");
}
