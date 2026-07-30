"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  parseConfluenceUrl,
  type ConfluenceSourcePreview,
  type ConfluenceSpacePreview,
  type ConfluenceTreePage,
} from "@/lib/projects/confluence-source";
import type { ConfluencePageScope } from "@/types/projects";
import { cn } from "@/lib/utils";

interface Props {
  sourceUrl: string;
  scopes: ConfluencePageScope[];
  onSelect: (url: string, scopes: ConfluencePageScope[]) => void;
}

function responseError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return `Could not load pages (${status})`;
}

export function ConfluenceSpaceBrowser({ sourceUrl, scopes, onSelect }: Props) {
  const parsed = useMemo(() => parseConfluenceUrl(sourceUrl), [sourceUrl]);
  const selectedSpaceUrl = useMemo(() => {
    if (!parsed) return "";
    const key = scopes[0]?.space_key ?? parsed.space_key;
    if (!key) return "";
    return `${parsed.base_url}/wiki/spaces/${encodeURIComponent(key)}`;
  }, [parsed, scopes]);

  const [mode, setMode] = useState<"space" | "page">(
    scopes.length ? "page" : "space",
  );
  const [preview, setPreview] = useState<ConfluenceSpacePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedSubtreeIds, setLoadedSubtreeIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingSubtreeIds, setLoadingSubtreeIds] = useState<Set<string>>(
    new Set(),
  );
  const [subtreeError, setSubtreeError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setMode(scopes.length ? "page" : "space");
  }, [scopes.length]);

  useEffect(() => {
    setPreview(null);
    setError("");
    setExpanded(new Set());
    setLoadedSubtreeIds(new Set());
    setLoadingSubtreeIds(new Set());
    setSubtreeError("");
    setQuery("");
  }, [selectedSpaceUrl]);

  const loadTree = useCallback(async () => {
    if (!selectedSpaceUrl || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/projects/confluence/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: selectedSpaceUrl }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: ConfluenceSpacePreview;
      };
      if (!response.ok || body.data?.kind !== "space") {
        throw new Error(responseError(body, response.status));
      }
      setPreview(body.data);
      setExpanded(new Set());
      setLoadedSubtreeIds(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [loading, selectedSpaceUrl]);

  useEffect(() => {
    if (mode === "page" && !preview && !loading && !error) {
      void loadTree();
    }
  }, [error, loadTree, loading, mode, preview]);

  const childrenByParent = useMemo(() => {
    const byParent = new Map<string, ConfluenceTreePage[]>();
    const ids = new Set(preview?.pages.map((page) => page.id) ?? []);
    for (const page of preview?.pages ?? []) {
      const parent =
        page.parent_id && ids.has(page.parent_id) ? page.parent_id : "";
      const children = byParent.get(parent) ?? [];
      children.push(page);
      byParent.set(parent, children);
    }
    for (const children of byParent.values()) {
      children.sort((left, right) => left.title.localeCompare(right.title));
    }
    return byParent;
  }, [preview]);

  const selectedIds = useMemo(
    () => new Set(scopes.map((selection) => selection.page_id)),
    [scopes],
  );

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingPageIds = useMemo(() => {
    if (!normalizedQuery) return new Set<string>();
    return new Set(
      (preview?.pages ?? [])
        .filter((page) =>
          page.title.toLocaleLowerCase().includes(normalizedQuery),
        )
        .map((page) => page.id),
    );
  }, [normalizedQuery, preview]);

  const visiblePageIds = useMemo(() => {
    if (!normalizedQuery) return null;
    const pages = preview?.pages ?? [];
    const byId = new Map(pages.map((page) => [page.id, page]));
    const visible = new Set(matchingPageIds);
    for (const id of matchingPageIds) {
      let parentId = byId.get(id)?.parent_id ?? null;
      while (parentId) {
        visible.add(parentId);
        parentId = byId.get(parentId)?.parent_id ?? null;
      }
    }
    return visible;
  }, [matchingPageIds, normalizedQuery, preview]);

  const descendantCount = useCallback(
    (pageId: string): number => {
      let count = 0;
      const visit = (parentId: string) => {
        for (const child of childrenByParent.get(parentId) ?? []) {
          count += 1;
          visit(child.id);
        }
      };
      visit(pageId);
      return count;
    },
    [childrenByParent],
  );

  const isDescendantOf = useCallback(
    (pageId: string, ancestorId: string): boolean => {
      const byId = new Map(
        (preview?.pages ?? []).map((page) => [page.id, page]),
      );
      let parentId = byId.get(pageId)?.parent_id ?? null;
      while (parentId) {
        if (parentId === ancestorId) return true;
        parentId = byId.get(parentId)?.parent_id ?? null;
      }
      return false;
    },
    [preview],
  );

  if (!selectedSpaceUrl) return null;

  const selectPage = (page: ConfluenceTreePage) => {
    if (selectedIds.has(page.id)) {
      onSelect(
        selectedSpaceUrl,
        scopes.filter((selection) => selection.page_id !== page.id),
      );
      return;
    }
    const coveringSelection = scopes.find(
      (selection) =>
        selection.include_descendants &&
        isDescendantOf(page.id, selection.page_id),
    );
    if (coveringSelection) return;

    const next = scopes.filter(
      (selection) => !isDescendantOf(selection.page_id, page.id),
    );
    next.push({
      page_id: page.id,
      page_title: page.title,
      space_key: preview?.space_key ?? scopes[0]?.space_key ?? "",
      include_descendants: true,
    });
    onSelect(selectedSpaceUrl, next);
  };

  const setIncludeDescendants = (
    pageId: string,
    includeDescendants: boolean,
  ) => {
    let next = scopes.map((selection) =>
      selection.page_id === pageId
        ? { ...selection, include_descendants: includeDescendants }
        : selection,
    );
    if (includeDescendants) {
      next = next.filter(
        (selection) =>
          selection.page_id === pageId ||
          !isDescendantOf(selection.page_id, pageId),
      );
    }
    onSelect(selectedSpaceUrl, next);
  };

  const loadSubtree = async (page: ConfluenceTreePage) => {
    if (loadedSubtreeIds.has(page.id)) {
      setExpanded((current) => new Set(current).add(page.id));
      return;
    }
    if (loadingSubtreeIds.has(page.id)) return;

    setLoadingSubtreeIds((current) => new Set(current).add(page.id));
    setSubtreeError("");
    try {
      const response = await fetch("/api/projects/confluence/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: page.url }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: ConfluenceSourcePreview;
      };
      if (!response.ok || body.data?.kind !== "page") {
        throw new Error(responseError(body, response.status));
      }
      const subtree = body.data;

      setPreview((current) => {
        if (!current) return current;
        const pagesById = new Map(
          current.pages.map((candidate) => [candidate.id, candidate]),
        );
        for (const candidate of subtree.pages) {
          const existing = pagesById.get(candidate.id);
          pagesById.set(
            candidate.id,
            candidate.id === page.id && existing
              ? {
                  ...candidate,
                  parent_id: existing.parent_id,
                  depth: existing.depth,
                }
              : candidate,
          );
        }
        return {
          ...current,
          pages: [...pagesById.values()],
          truncated: current.truncated || subtree.truncated,
        };
      });
      setLoadedSubtreeIds((current) => {
        const next = new Set(current);
        next.add(page.id);
        if (!subtree.truncated) {
          for (const candidate of subtree.pages) next.add(candidate.id);
        }
        return next;
      });
      setExpanded((current) => new Set(current).add(page.id));
    } catch (caught) {
      setSubtreeError(
        `Could not load subpages for ${page.title}: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
    } finally {
      setLoadingSubtreeIds((current) => {
        const next = new Set(current);
        next.delete(page.id);
        return next;
      });
    }
  };

  const toggleExpanded = (page: ConfluenceTreePage) => {
    if (expanded.has(page.id)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(page.id);
        return next;
      });
      return;
    }
    if (loadedSubtreeIds.has(page.id)) {
      setExpanded((current) => new Set(current).add(page.id));
      return;
    }
    void loadSubtree(page);
  };

  const renderPage = (page: ConfluenceTreePage, depth: number) => {
    if (visiblePageIds && !visiblePageIds.has(page.id)) return null;
    const children = (childrenByParent.get(page.id) ?? []).filter(
      (child) => !visiblePageIds || visiblePageIds.has(child.id),
    );
    const isExpanded = normalizedQuery
      ? children.length > 0
      : expanded.has(page.id);
    const isSelected = selectedIds.has(page.id);
    const coveringSelection = scopes.find(
      (selection) =>
        selection.include_descendants &&
        isDescendantOf(page.id, selection.page_id),
    );
    const isCovered = Boolean(coveringSelection);
    const isMatch = matchingPageIds.has(page.id);
    const isLoadingSubtree = loadingSubtreeIds.has(page.id);
    const canExpand = children.length > 0 || !loadedSubtreeIds.has(page.id);
    return (
      <li
        key={page.id}
        role="treeitem"
        aria-expanded={canExpand ? isExpanded : undefined}
        aria-selected={isSelected}
      >
        <div
          className={cn(
            "flex items-center gap-1 rounded-md py-0.5 pr-2",
            (isSelected || isCovered) && "bg-primary/10",
          )}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          {canExpand ? (
            <button
              type="button"
              onClick={() => toggleExpanded(page)}
              disabled={isLoadingSubtree}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${page.title}`}
            >
              {isLoadingSubtree ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="h-5 w-5" />
          )}
          <button
            type="button"
            onClick={() => selectPage(page)}
            disabled={isCovered}
            className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-xs"
            title={
              coveringSelection
                ? `Included by ${coveringSelection.page_title}`
                : undefined
            }
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/20"
                  : isCovered
                    ? "border-primary/50 bg-primary/20 text-primary"
                    : "border-border",
              )}
            >
              {isSelected || isCovered ? (
                <Check className="h-2.5 w-2.5" />
              ) : null}
            </span>
            <span
              className={cn(
                "truncate",
                isMatch && "font-semibold text-primary",
              )}
              title={page.title}
            >
              {page.title}
            </span>
          </button>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label={`Open ${page.title} in Confluence`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {children.length && isExpanded ? (
          <ul role="group">
            {children.map((child) => renderPage(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  const roots = (childrenByParent.get("") ?? []).filter(
    (page) => !visiblePageIds || visiblePageIds.has(page.id),
  );
  const selectedPages = scopes
    .map((selection) => ({
      selection,
      page: preview?.pages.find((page) => page.id === selection.page_id),
    }))
    .filter(
      (
        item,
      ): item is {
        selection: ConfluencePageScope;
        page: ConfluenceTreePage;
      } => Boolean(item.page),
    );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <fieldset className="space-y-2 p-3">
        <legend className="mb-2 text-xs font-semibold">
          What should be included?
        </legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="confluence-source-scope"
            checked={mode === "space"}
            onChange={() => {
              setMode("space");
              onSelect(selectedSpaceUrl, []);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Entire space</span>
            <span className="block text-xs text-muted-foreground">
              Include every accessible page in this space.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="confluence-source-scope"
            checked={mode === "page"}
            onChange={() => setMode("page")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Choose a page tree</span>
            <span className="block text-xs text-muted-foreground">
              Browse this space and choose one or more page roots.
            </span>
          </span>
        </label>
      </fieldset>

      {mode === "page" ? (
        <div className="border-t border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading page hierarchy…
            </div>
          ) : error ? (
            <div className="space-y-2 px-3 py-3">
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadTree()}
              >
                Retry
              </Button>
            </div>
          ) : preview ? (
            <>
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <p className="text-xs font-medium">
                  Pages in {preview.space_key}
                </p>
                <p className="text-xs text-muted-foreground">
                  {normalizedQuery
                    ? `${matchingPageIds.size} match${matchingPageIds.size === 1 ? "" : "es"}`
                    : `${preview.pages.length} loaded`}
                  {!normalizedQuery && preview.truncated
                    ? " · expand a page for its complete subtree"
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search pages by title…"
                  aria-label="Search pages in this Confluence space"
                  className="w-full bg-transparent py-2 text-xs outline-none"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Clear page search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {roots.length ? (
                <>
                  {subtreeError ? (
                    <p
                      role="alert"
                      className="border-b border-border/60 px-3 py-2 text-xs text-destructive"
                    >
                      {subtreeError}
                    </p>
                  ) : null}
                  <ul
                    role="tree"
                    aria-multiselectable="true"
                    className="max-h-64 overflow-y-auto px-2 py-2"
                  >
                    {roots.map((page) => renderPage(page, 0))}
                  </ul>
                </>
              ) : (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {normalizedQuery
                    ? "No page titles match this search."
                    : "No accessible pages found in this space."}
                </p>
              )}
            </>
          ) : null}
        </div>
      ) : null}

      {mode === "page" && selectedPages.length ? (
        <fieldset className="space-y-2 border-t border-border bg-muted/20 p-3">
          <legend className="mb-2 text-xs font-semibold">
            Selected page roots ({selectedPages.length})
          </legend>
          <div className="max-h-40 space-y-2 overflow-y-auto">
            {selectedPages.map(({ selection, page }) => (
              <div
                key={selection.page_id}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {selection.page_title}
                </span>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={selection.include_descendants}
                    onChange={(event) =>
                      setIncludeDescendants(
                        selection.page_id,
                        event.target.checked,
                      )
                    }
                  />
                  Include subpages ({descendantCount(page.id)})
                </label>
                <button
                  type="button"
                  onClick={() => selectPage(page)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${selection.page_title}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
