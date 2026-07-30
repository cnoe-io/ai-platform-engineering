import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import {
  parseConfluenceUrl,
  type ConfluenceTreePage,
} from "@/lib/projects/confluence-source";

const PAGE_LIMIT = 100;
const MAX_PAGES = 500;

interface AccessibleResource {
  id?: string;
  url?: string;
}

interface SearchContent {
  id?: string;
  title?: string;
  space?: { key?: string };
  ancestors?: Array<{ id?: string; title?: string }>;
}

interface SearchResult {
  title?: string;
  content?: SearchContent;
}

interface SearchResponse {
  results?: SearchResult[];
  _links?: { next?: string };
}

function pageUrl(siteUrl: string, spaceKey: string, pageId: string): string {
  return `${siteUrl.replace(/\/$/, "")}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${pageId}`;
}

function spaceUrl(siteUrl: string, spaceKey: string): string {
  return `${siteUrl.replace(/\/$/, "")}/wiki/spaces/${encodeURIComponent(spaceKey)}`;
}

function cqlQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function confluenceSearch(
  gateway: string,
  token: string,
  cql: string,
  limit: number,
  nextLink?: string,
): Promise<SearchResponse> {
  const params = nextLink
    ? new URL(nextLink, "https://confluence-pagination.invalid").searchParams
    : new URLSearchParams();
  if (!params.has("cql")) params.set("cql", cql);
  if (!params.has("expand")) {
    params.set("expand", "content.space,content.ancestors");
  }
  if (!params.has("limit")) params.set("limit", String(limit));
  const response = await fetch(`${gateway}/wiki/rest/api/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      "Your Atlassian connection cannot read this page",
      403,
      "CONFLUENCE_PAGE_FORBIDDEN",
    );
  }
  if (!response.ok) {
    throw new ApiError(
      `Confluence page lookup failed (${response.status})`,
      502,
      "CONFLUENCE_LOOKUP_FAILED",
    );
  }
  return (await response.json().catch(() => ({}))) as SearchResponse;
}

async function collectConfluencePages(
  gateway: string,
  token: string,
  cql: string,
  maxPages: number,
): Promise<{ results: SearchResult[]; truncated: boolean }> {
  const results: SearchResult[] = [];
  const seenPageIds = new Set<string>();
  const seenNextLinks = new Set<string>();
  let nextLink: string | undefined;

  while (results.length < maxPages) {
    const data = await confluenceSearch(
      gateway,
      token,
      cql,
      Math.min(PAGE_LIMIT, maxPages - results.length),
      nextLink,
    );
    for (const result of data.results ?? []) {
      const pageId = result.content?.id;
      if (!pageId || seenPageIds.has(pageId)) continue;
      seenPageIds.add(pageId);
      results.push(result);
      if (results.length >= maxPages) break;
    }

    const returnedNext = data._links?.next;
    if (!returnedNext) {
      return { results, truncated: false };
    }
    if (seenNextLinks.has(returnedNext)) {
      return { results, truncated: true };
    }
    seenNextLinks.add(returnedNext);
    nextLink = returnedNext;
  }

  return { results, truncated: Boolean(nextLink) };
}

function orderForest(pages: ConfluenceTreePage[]): ConfluenceTreePage[] {
  const known = new Set(pages.map((page) => page.id));
  const children = new Map<string, ConfluenceTreePage[]>();
  for (const page of pages) {
    const parentId =
      page.parent_id && known.has(page.parent_id) ? page.parent_id : "";
    const siblings = children.get(parentId) ?? [];
    siblings.push(page);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.title.localeCompare(b.title));
  }

  const ordered: ConfluenceTreePage[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      if (visited.has(page.id)) continue;
      visited.add(page.id);
      ordered.push({ ...page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit("", 0);
  for (const page of pages) {
    if (!visited.has(page.id)) {
      ordered.push({ ...page, parent_id: null, depth: 0 });
      visit(page.id, 1);
    }
  }
  return ordered;
}

function orderTree(
  root: ConfluenceTreePage,
  descendants: ConfluenceTreePage[],
): ConfluenceTreePage[] {
  const known = new Set([root.id, ...descendants.map((page) => page.id)]);
  const children = new Map<string, ConfluenceTreePage[]>();
  for (const page of descendants) {
    const parentId =
      page.parent_id && known.has(page.parent_id) ? page.parent_id : root.id;
    const siblings = children.get(parentId) ?? [];
    siblings.push(page);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.title.localeCompare(b.title));
  }

  const ordered: ConfluenceTreePage[] = [root];
  const visit = (parentId: string, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      ordered.push({ ...page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(root.id, 1);
  return ordered;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const sub = (session as { sub?: string } | undefined)?.sub;
  if (!sub) {
    throw new ApiError(
      "Sign in to preview Confluence pages",
      401,
      "UNAUTHORIZED",
    );
  }

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const parsed =
    typeof body.url === "string" ? parseConfluenceUrl(body.url) : null;
  if (!parsed || (!parsed.page_id && !parsed.space_key)) {
    throw new ApiError(
      "Paste a Confluence space or page URL",
      400,
      "INVALID_CONFLUENCE_URL",
    );
  }

  const service = await getProviderConnectionService();
  const connection = (
    await service.listConnections({ type: "user", id: sub })
  ).find(
    (candidate) =>
      candidate.provider === "atlassian" && candidate.status === "connected",
  );
  if (!connection) {
    throw new ApiError(
      "Connect Atlassian before previewing a page",
      409,
      "ATLASSIAN_NOT_CONNECTED",
    );
  }
  const token = (await service.refreshConnection(connection.id)).accessToken;

  const resourcesResponse = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    },
  );
  if (!resourcesResponse.ok) {
    throw new ApiError(
      "Could not resolve the connected Atlassian site",
      502,
      "ATLASSIAN_RESOURCES_FAILED",
    );
  }
  const resources = (await resourcesResponse
    .json()
    .catch(() => [])) as AccessibleResource[];
  const site = resources.find((resource) => {
    if (!resource.id || !resource.url) return false;
    try {
      return new URL(resource.url).origin === parsed.base_url;
    } catch {
      return false;
    }
  });
  if (!site?.id || !site.url) {
    throw new ApiError(
      "This source is not on your connected Atlassian site",
      400,
      "CONFLUENCE_SITE_MISMATCH",
    );
  }

  const gateway = `https://api.atlassian.com/ex/confluence/${site.id}`;
  if (!parsed.page_id && parsed.space_key) {
    const requestedSpaceKey = parsed.space_key;
    const found: Array<{
      page: ConfluenceTreePage;
      ancestorIds: string[];
      spaceKey: string;
    }> = [];
    const pageSearch = await collectConfluencePages(
      gateway,
      token,
      `space="${cqlQuote(requestedSpaceKey)}" and type=page`,
      MAX_PAGES,
    );
    for (const result of pageSearch.results) {
      const content = result.content;
      const resolvedSpaceKey = content?.space?.key;
      if (!content?.id || !resolvedSpaceKey) continue;
      found.push({
        page: {
          id: content.id,
          title: content.title || result.title || `Page ${content.id}`,
          parent_id: null,
          depth: 0,
          url: pageUrl(site.url, resolvedSpaceKey, content.id),
        },
        ancestorIds: (content.ancestors ?? [])
          .map((ancestor) => ancestor.id)
          .filter((id): id is string => Boolean(id)),
        spaceKey: resolvedSpaceKey,
      });
    }

    const resolvedSpaceKey = found[0]?.spaceKey ?? requestedSpaceKey;
    const known = new Set(found.map(({ page }) => page.id));
    const pages = orderForest(
      found
        .filter(
          ({ spaceKey: key }) =>
            key.toLocaleUpperCase() === resolvedSpaceKey.toLocaleUpperCase(),
        )
        .map(({ page, ancestorIds }) => ({
          ...page,
          parent_id:
            [...ancestorIds].reverse().find((id) => known.has(id)) ?? null,
        })),
    );
    return successResponse({
      kind: "space",
      source_url: spaceUrl(site.url, resolvedSpaceKey),
      space_key: resolvedSpaceKey,
      pages,
      truncated: pageSearch.truncated,
    });
  }

  const rootSearch = await confluenceSearch(
    gateway,
    token,
    `id=${parsed.page_id}`,
    1,
  );
  const rootResult = rootSearch.results?.[0];
  const rootContent = rootResult?.content;
  const spaceKey = rootContent?.space?.key;
  if (!rootContent?.id || !spaceKey) {
    throw new ApiError(
      "Page not found or not accessible",
      404,
      "CONFLUENCE_PAGE_NOT_FOUND",
    );
  }
  const rootId = rootContent.id;
  const rootTitle = rootContent.title || rootResult.title || `Page ${rootId}`;
  const descendants: ConfluenceTreePage[] = [];
  const descendantSearch = await collectConfluencePages(
    gateway,
    token,
    `ancestor=${rootId} and type=page`,
    MAX_PAGES,
  );
  for (const result of descendantSearch.results) {
    const content = result.content;
    if (
      !content?.id ||
      content.space?.key?.toLocaleUpperCase() !== spaceKey.toLocaleUpperCase()
    ) {
      continue;
    }
    const ancestors = content.ancestors ?? [];
    const rootIndex = ancestors.findIndex((ancestor) => ancestor.id === rootId);
    if (rootIndex < 0) continue;
    const parentId =
      [...ancestors].reverse().find((ancestor) => ancestor.id)?.id ?? rootId;
    descendants.push({
      id: content.id,
      title: content.title || result.title || `Page ${content.id}`,
      parent_id: parentId,
      depth: ancestors.length - rootIndex,
      url: pageUrl(site.url, spaceKey, content.id),
    });
  }

  const root: ConfluenceTreePage = {
    id: rootId,
    title: rootTitle,
    parent_id: null,
    depth: 0,
    url: pageUrl(site.url, spaceKey, rootId),
  };
  const pages = orderTree(root, descendants);
  return successResponse({
    kind: "page",
    // Page IDs remain stable when Confluence pages move between spaces, while
    // the space segment in an old copied URL can become stale. The resolved
    // page metadata is authoritative, so persist a canonical URL instead of
    // rejecting an otherwise accessible page.
    source_url: root.url,
    scope: {
      page_id: rootId,
      page_title: rootTitle,
      space_key: spaceKey,
      include_descendants: true,
    },
    pages,
    truncated: descendantSearch.truncated,
  });
});
