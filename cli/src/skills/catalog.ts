/**
 * Skills catalog manifest fetcher.
 *
 * Source: GitHub Releases static JSON manifest.
 * Cache: ~/.config/caipe/catalog-cache.json (1-hour TTL).
 * Stale cache is returned when the source is unreachable.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { catalogCachePath, globalConfigDir } from "../platform/config.js";
import { mkdirSync } from "fs";

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
    throw new Error(
      `Skills catalog unavailable and no local cache found: ${String(err)}`,
    );
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
      `Checksum mismatch!\n  expected: ${expected}\n  actual:   ${actual}\n` +
        `This may indicate a network interception. ` +
        `Use --force only if you trust the source.`,
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
  writeFileSync(catalogCachePath(), JSON.stringify(cache, null, 2) + "\n", "utf8");
}
