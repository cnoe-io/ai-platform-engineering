/**
 * Shared catalog query forwarding for GET /api/skills → Python GET /skills (T058, T064).
 */

export function applySkillsCatalogQueryToBackendUrl(
  url: URL,
  sourceParams: URLSearchParams,
): void {
  const q = sourceParams.get("q");
  if (q?.trim()) url.searchParams.set("q", q.trim());

  const source = sourceParams.get("source");
  if (source?.trim()) url.searchParams.set("source", source.trim().toLowerCase());

  const visibility = sourceParams.get("visibility");
  if (visibility?.trim()) {
    url.searchParams.set("visibility", visibility.trim().toLowerCase());
  }

  const tags = sourceParams.get("tags");
  if (tags?.trim()) url.searchParams.set("tags", tags.trim());

  if (sourceParams.get("include_content") === "true") {
    url.searchParams.set("include_content", "true");
  }

  const page = sourceParams.get("page");
  const pageSize = sourceParams.get("page_size");
  if (page != null && page !== "") {
    const p = Math.max(1, parseInt(page, 10) || 1);
    url.searchParams.set("page", String(p));
    const ps = Math.min(100, Math.max(1, parseInt(pageSize || "50", 10) || 50));
    url.searchParams.set("page_size", String(ps));
  }
}
