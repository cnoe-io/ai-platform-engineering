/**
 * Skills catalog manifest fetcher.
 *
 * Source: GitHub Releases static JSON manifest.
 * Cache: ~/.config/caipe/catalog-cache.json (1-hour TTL).
 * Stale cache is returned when the source is unreachable.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import {
  catalogCachePath,
  getA2aUrl,
  globalConfigDir,
  serverEndpoints,
  skillsCachePath,
} from "../platform/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  url: string;
  checksum: string; // "sha256:<hex>"
}

export interface Catalog {
  version: string;
  generated: string;
  skills: CatalogEntry[];
}

interface CachedCatalog {
  catalog: Catalog;
  cachedAt: string; // ISO 8601
}

const CATALOG_URL =
  "https://github.com/cnoe-io/ai-platform-engineering/releases/latest/download/catalog.json";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the skills catalog.
 * Uses a 1-hour cache; falls back to stale cache on network error.
 * Throws only if both network and cache are unavailable.
 */
export async function fetchCatalog(): Promise<Catalog> {
  const cached = readCache();

  // Use fresh cache if TTL not expired
  if (cached && Date.now() - Date.parse(cached.cachedAt) < CACHE_TTL_MS) {
    return cached.catalog;
  }

  // Try to fetch fresh catalog
  try {
    const res = await fetch(CATALOG_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const catalog = (await res.json()) as Catalog;
    writeCache(catalog);
    return catalog;
  } catch (err) {
    if (cached) {
      process.stderr.write(
        `[WARNING] Could not reach skills catalog (${String(err)}). Using cached version.\n`,
      );
      return cached.catalog;
    }
    throw new Error(`Skills catalog unavailable and no local cache found: ${String(err)}`);
  }
}

/**
 * Verify that the content of a skill file matches the catalog checksum.
 * Throws if the checksum does not match.
 */
export function verifyChecksum(content: string, checksum: string): void {
  if (!checksum.startsWith("sha256:")) {
    throw new Error(`Unknown checksum format: ${checksum}`);
  }
  const expected = checksum.slice(7);
  const actual = createHash("sha256").update(content, "utf8").digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch!\n  expected: ${expected}\n  actual:   ${actual}\nThis may indicate a network interception. Use --force only if you trust the source.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function readCache(): CachedCatalog | null {
  const path = catalogCachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedCatalog;
  } catch {
    return null;
  }
}

function writeCache(catalog: Catalog): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cache: CachedCatalog = { catalog, cachedAt: new Date().toISOString() };
  writeFileSync(catalogCachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Supervisor skills API (GET /skills on the A2A backend)
// ---------------------------------------------------------------------------

export interface SupervisorSkill {
  name: string;
  description: string;
  source: string;
  metadata?: { tags?: string[]; [key: string]: unknown };
}

interface SupervisorSkillsResponse {
  skills: SupervisorSkill[];
  meta: { total: number; sources_loaded?: string[]; unavailable_sources?: string[] };
}

interface CachedSupervisorSkills {
  skills: SupervisorSkill[];
  meta: SupervisorSkillsResponse["meta"];
  cachedAt: string;
}

const SUPERVISOR_SKILLS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function readSupervisorSkillsCache(): CachedSupervisorSkills | null {
  const path = skillsCachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedSupervisorSkills;
  } catch {
    return null;
  }
}

function writeSupervisorSkillsCache(data: SupervisorSkillsResponse): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cached: CachedSupervisorSkills = { ...data, cachedAt: new Date().toISOString() };
  writeFileSync(skillsCachePath(), `${JSON.stringify(cached, null, 2)}\n`, "utf8");
}

/**
 * Fetch skills loaded in the supervisor via GET /skills.
 * Uses 5-minute cache; stale cache returned on network error.
 */
export async function fetchSupervisorSkills(
  getToken: () => Promise<string>,
): Promise<{ skills: SupervisorSkill[]; meta: SupervisorSkillsResponse["meta"] }> {
  const cached = readSupervisorSkillsCache();
  if (cached && Date.now() - Date.parse(cached.cachedAt) < SUPERVISOR_SKILLS_TTL_MS) {
    return { skills: cached.skills, meta: cached.meta };
  }

  const a2aUrl = getA2aUrl();
  if (!a2aUrl) {
    if (cached) return { skills: cached.skills, meta: cached.meta };
    throw new Error(
      "No CAIPE server URL configured. Set CAIPE_SERVER_URL or run `caipe config set server.url <url>`.",
    );
  }

  try {
    const token = await getToken();
    const url = serverEndpoints(a2aUrl).skills;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as SupervisorSkillsResponse;
    writeSupervisorSkillsCache(data);
    return { skills: data.skills, meta: data.meta };
  } catch (err) {
    if (cached) {
      return { skills: cached.skills, meta: cached.meta };
    }
    throw new Error(`Supervisor skills unavailable: ${String(err)}`);
  }
}
