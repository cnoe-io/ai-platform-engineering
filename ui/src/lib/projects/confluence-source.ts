import type { ConfluencePageScope } from "@/types/projects";

export interface ParsedConfluenceUrl {
  url: string;
  base_url: string;
  space_key?: string;
  page_id?: string;
}

export interface ConfluenceTreePage {
  id: string;
  title: string;
  parent_id: string | null;
  depth: number;
  url: string;
}

export interface ConfluenceSourcePreview {
  kind: "page";
  source_url: string;
  scope: ConfluencePageScope;
  pages: ConfluenceTreePage[];
  truncated: boolean;
}

export interface ConfluenceSpacePreview {
  kind: "space";
  source_url: string;
  space_key: string;
  pages: ConfluenceTreePage[];
  truncated: boolean;
}

/** Parse the stable identifiers carried by common Confluence Cloud URL forms. */
export function parseConfluenceUrl(input: string): ParsedConfluenceUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const spaceMatch = url.pathname.match(/\/wiki\/spaces\/([^/?#]+)/i);
  const modernPageMatch = url.pathname.match(
    /\/wiki\/spaces\/[^/?#]+\/pages\/(\d+)(?:\/|$)/i,
  );
  const compactPageMatch = url.pathname.match(/\/wiki\/pages\/(\d+)(?:\/|$)/i);
  const legacyPageId =
    /\/wiki\/pages\/viewpage\.action$/i.test(url.pathname)
      ? url.searchParams.get("pageId")
      : null;
  const pageId =
    modernPageMatch?.[1] ??
    compactPageMatch?.[1] ??
    (legacyPageId && /^\d+$/.test(legacyPageId) ? legacyPageId : undefined);

  return {
    url: trimmed,
    base_url: url.origin,
    space_key: spaceMatch ? decodeURIComponent(spaceMatch[1]) : undefined,
    page_id: pageId,
  };
}

export function isConfluencePageUrl(input: string): boolean {
  return Boolean(parseConfluenceUrl(input)?.page_id);
}

export function normalizeConfluencePageScope(
  value: unknown,
): ConfluencePageScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const scope = value as Record<string, unknown>;
  const pageId =
    typeof scope.page_id === "string" ? scope.page_id.trim() : "";
  const pageTitle =
    typeof scope.page_title === "string" ? scope.page_title.trim() : "";
  const spaceKey =
    typeof scope.space_key === "string" ? scope.space_key.trim() : "";
  if (!/^\d+$/.test(pageId) || !pageTitle || !spaceKey) return undefined;
  return {
    page_id: pageId,
    page_title: pageTitle,
    space_key: spaceKey,
    include_descendants: scope.include_descendants !== false,
  };
}

/** Normalize, deduplicate, and bound a multi-root Confluence page selection. */
export function normalizeConfluencePageScopes(
  value: unknown,
): ConfluencePageScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: ConfluencePageScope[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, 100)) {
    const scope = normalizeConfluencePageScope(candidate);
    if (!scope || seen.has(scope.page_id)) continue;
    seen.add(scope.page_id);
    scopes.push(scope);
  }
  return scopes;
}
