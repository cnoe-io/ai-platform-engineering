/**
 * Helpers shared by import flows (zip import, repo import, future
 * marketplace imports) that need to detect duplicates and generate
 * unique replacement names/ids.
 *
 * The functions here are pure and deliberately framework-free so the
 * same logic can run server-side (in the import API route) and
 * client-side (in the duplicate-resolution modal). Keeping the
 * suggestion logic in one place stops the UI suggesting "Foo
 * (imported)" while the server independently writes "Foo (imported
 * 2)" or vice versa.
 *
 * Conventions:
 *   * Renamed names use the suffix `(imported)` on the first
 *     collision and `(imported N)` for N>=2. Matches the existing
 *     "(copy)" convention used by `/api/skills/configs/[id]/clone`,
 *     so users see a familiar pattern even when the import path is
 *     different.
 *   * IDs are derived from the (possibly renamed) display name via
 *     `slugifySkillName`, mirroring the slug rule used everywhere
 *     else in the codebase (POST /api/skills/configs, clone route,
 *     templates/import). A small random suffix keeps two
 *     simultaneous imports of the same name from colliding on the
 *     unique `agent_skills.id` index.
 */

/**
 * Convert a free-form skill display name into the safe slug fragment
 * used inside `skill-<slug>-<random>` ids. Rules:
 *
 *   * lowercase
 *   * non-alphanumeric → "-"
 *   * collapse runs of "-"
 *   * trim leading/trailing "-"
 *
 * Mirrors POST /api/skills/configs (line 221) and the clone route's
 * slugger (line 74). Exposed here so the import path produces the
 * same shape without re-implementing the rule inline.
 */
export function slugifySkillName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generate a unique skill id from a display name, matching the shape
 * used by POST /api/skills/configs:
 *
 *     skill-<slug>-<random>
 *
 * The `random` segment is 9 chars of base36 entropy (~46 bits), more
 * than enough to avoid collisions in any realistic import batch. We
 * fall back to a hard-coded `"skill"` slug if the name slugifies to
 * empty so the id remains well-formed even for pathological names
 * like `"---"` or `"😀"`.
 */
export function generateSkillIdFromName(name: string): string {
  const slug = slugifySkillName(name) || "skill";
  const rand = Math.random().toString(36).slice(2, 11);
  return `skill-${slug}-${rand}`;
}

/**
 * Produce a name that doesn't collide with any name in `existingNames`.
 *
 * Strategy:
 *   1. If `original` itself is unused, return it.
 *   2. Otherwise try `${original} (imported)`.
 *   3. Otherwise try `${original} (imported 2)`, `... 3` … up to a
 *      sane upper bound. The bound exists so a corrupted comparator
 *      can't loop forever; in practice a user with 99 colliding
 *      imports has bigger problems.
 *   4. Final fallback appends a random suffix so we always return
 *      something unique.
 *
 * Comparison is case-insensitive on a trimmed copy of each name so
 * `"Foo"` and `"foo "` are treated as the same. The returned string
 * preserves the casing of `original`.
 *
 * @example
 *   suggestRenamedSkillName("Foo", new Set(["Foo"]))             // "Foo (imported)"
 *   suggestRenamedSkillName("Foo", new Set(["Foo", "Foo (imported)"])) // "Foo (imported 2)"
 *   suggestRenamedSkillName("Bar", new Set(["Foo"]))             // "Bar"
 */
export function suggestRenamedSkillName(
  original: string,
  existingNames: Iterable<string>,
): string {
  const taken = new Set<string>();
  for (const n of existingNames) {
    taken.add(normaliseForCompare(n));
  }
  const trimmed = (original || "").trim() || "Imported skill";
  if (!taken.has(normaliseForCompare(trimmed))) {
    return trimmed;
  }
  const firstCandidate = `${trimmed} (imported)`;
  if (!taken.has(normaliseForCompare(firstCandidate))) {
    return firstCandidate;
  }
  // Cap the linear probe so a buggy `existingNames` source can't
  // hang the import flow. 99 attempts is well past anything a real
  // user would hit; the random fallback below is a defensive net.
  for (let i = 2; i < 100; i++) {
    const candidate = `${trimmed} (imported ${i})`;
    if (!taken.has(normaliseForCompare(candidate))) {
      return candidate;
    }
  }
  // Final fallback: random suffix. Guaranteed unique unless an
  // adversary has pre-populated `existingNames` with every base36
  // string, which we accept as a non-issue.
  const rand = Math.random().toString(36).slice(2, 6);
  return `${trimmed} (imported ${rand})`;
}

/**
 * Compare-only normalisation: trim, collapse internal whitespace,
 * lowercase. We don't store this back to the user — it's purely the
 * key under which we ask "have we seen this name yet?".
 */
function normaliseForCompare(s: string): string {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Resolution shapes — shared by the modal and the import API route
// ---------------------------------------------------------------------------

/**
 * What an import flow should do with a candidate that collides with
 * an existing skill (by name or id). Designed to be sent over the
 * wire as part of the import request body.
 */
export type ImportConflictAction = "skip" | "overwrite" | "rename";

/**
 * One pending decision presented to the user. The modal mutates this
 * shape locally and emits the final list back to the caller via
 * `onResolve`.
 */
export interface ImportConflictDecision {
  /** Stable client-side id for this candidate (e.g. zip-internal path). */
  candidateId: string;
  /** Display name from the source artifact (e.g. zip's SKILL.md frontmatter). */
  candidateName: string;
  /** Display name of the existing skill that collides with this one. */
  existingName: string;
  /** Existing skill id we'd be overwriting. Optional — name-only collisions don't always have one. */
  existingId?: string;
  /** Optional descriptive line (e.g. "12 KB SKILL.md, 3 ancillary files"). */
  summary?: string;
  /** Resolution chosen by the user. */
  action: ImportConflictAction;
  /** When `action === "rename"`, the new display name to import as. */
  renameTo?: string;
}
