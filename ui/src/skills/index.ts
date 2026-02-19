/**
 * Skills Template Client
 *
 * Fetches SKILL.md templates from the /api/skill-templates endpoint,
 * which reads them from the filesystem (charts/data/skills/).
 *
 * Templates can be hot-loaded by updating files on disk — the API
 * endpoint uses a 30-second cache TTL, so new skills appear without
 * a rebuild.
 */

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  title: string;
  category: string;
  icon: string;
  tags: string[];
  content: string;
}

/**
 * Fetch all skill templates from the API.
 * Results are cached in-memory for the page lifecycle.
 */
let _cache: SkillTemplate[] | null = null;
let _cachePromise: Promise<SkillTemplate[]> | null = null;

export async function fetchSkillTemplates(): Promise<SkillTemplate[]> {
  if (_cache) return _cache;
  if (_cachePromise) return _cachePromise;

  _cachePromise = fetch("/api/skill-templates")
    .then(async (res) => {
      if (!res.ok) {
        console.error("[Skills] Failed to fetch templates:", res.status);
        return [];
      }
      const data: SkillTemplate[] = await res.json();
      _cache = data;
      return data;
    })
    .catch((err) => {
      console.error("[Skills] Error fetching templates:", err);
      return [];
    })
    .finally(() => {
      _cachePromise = null;
    });

  return _cachePromise;
}

/**
 * Invalidate the client-side template cache.
 * Next fetch will reload from the API.
 */
export function invalidateTemplateCache(): void {
  _cache = null;
  _cachePromise = null;
}

/**
 * Get a template by ID (from cache).
 * Must call fetchSkillTemplates() first.
 */
export function getSkillTemplate(id: string): SkillTemplate | undefined {
  return _cache?.find((t) => t.id === id);
}

/**
 * Get all unique tags across all cached templates.
 * Must call fetchSkillTemplates() first.
 */
export function getAllTemplateTags(): string[] {
  if (!_cache) return [];
  const tagSet = new Set<string>();
  for (const template of _cache) {
    for (const tag of template.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

/**
 * Get templates filtered by category (from cache).
 * Must call fetchSkillTemplates() first.
 */
export function getTemplatesByCategory(category: string): SkillTemplate[] {
  if (!_cache) return [];
  return _cache.filter((t) => t.category === category);
}
