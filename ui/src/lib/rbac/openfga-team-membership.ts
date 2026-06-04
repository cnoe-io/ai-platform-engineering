import { listOpenFgaObjects } from "./openfga";

// 60s TTL keeps team-membership freshness reasonable without hammering the PDP
// during bursts of authorization checks. See spec FR-026 + plan A2.
const TEAM_MEMBERSHIP_CACHE_TTL_MS = 60_000;
const TEAM_MEMBERSHIP_CACHE_MAX_ENTRIES = 10_000;

const OPENFGA_SUBJECT_PATTERN = /^[A-Za-z0-9._%+@-]+$/;
const TEAM_OBJECT_PATTERN = /^team:([A-Za-z0-9._-]+)$/;

interface CacheEntry {
  slugs: string[];
  expiresAt: number;
}

const teamSlugsBySubject = new Map<string, CacheEntry>();

export interface ListUserTeamSlugsInput {
  subject: string;
}

function assertValidSubject(subject: string): void {
  if (!subject || subject.length === 0 || !OPENFGA_SUBJECT_PATTERN.test(subject)) {
    throw new Error(
      "listUserTeamSlugs: subject must be a non-empty OpenFGA-safe identifier",
    );
  }
}

function evictOldestIfFull(): void {
  if (teamSlugsBySubject.size < TEAM_MEMBERSHIP_CACHE_MAX_ENTRIES) {
    return;
  }
  const oldestKey = teamSlugsBySubject.keys().next().value;
  if (oldestKey !== undefined) {
    teamSlugsBySubject.delete(oldestKey);
  }
}

function readCache(subject: string): string[] | null {
  const entry = teamSlugsBySubject.get(subject);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    teamSlugsBySubject.delete(subject);
    return null;
  }
  // Refresh recency (LRU touch) by re-inserting.
  teamSlugsBySubject.delete(subject);
  teamSlugsBySubject.set(subject, entry);
  return entry.slugs;
}

function writeCache(subject: string, slugs: string[]): void {
  evictOldestIfFull();
  teamSlugsBySubject.set(subject, {
    slugs,
    expiresAt: Date.now() + TEAM_MEMBERSHIP_CACHE_TTL_MS,
  });
}

function parseSlugsFromObjects(objects: string[]): string[] {
  const slugs: string[] = [];
  for (const obj of objects) {
    const match = TEAM_OBJECT_PATTERN.exec(obj);
    if (match) {
      slugs.push(match[1]);
    }
  }
  return slugs;
}

/**
 * Return the list of team slugs that the user is a `member` of, according to
 * OpenFGA. Used by the BFF PDP to fan out team-mediated authorization checks
 * and to enumerate the user's accessible-agent universe.
 *
 * Results are cached in-process for 60s per subject. The cache is bounded to
 * 10k entries and evicted in insertion order when full. Errors are NOT cached.
 */
export async function listUserTeamSlugs(
  input: ListUserTeamSlugsInput,
): Promise<string[]> {
  const { subject } = input;
  assertValidSubject(subject);

  const cached = readCache(subject);
  if (cached !== null) {
    return cached;
  }

  const result = await listOpenFgaObjects({
    user: `user:${subject}`,
    relation: "member",
    type: "team",
  });
  const slugs = parseSlugsFromObjects(result.objects ?? []);
  writeCache(subject, slugs);
  return slugs;
}

/**
 * Test-only helper to reset the in-process cache between tests.
 *
 * Not exported from the package's public surface; tests import it via the
 * file path directly.
 */
export function __resetUserTeamCacheForTests(): void {
  teamSlugsBySubject.clear();
}
