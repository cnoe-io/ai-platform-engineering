/** Trim freeform gist tags and drop empty or duplicate values. */
export function normalizeGistTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const tag of input) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}
