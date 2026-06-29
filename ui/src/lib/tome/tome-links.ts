// Internal wiki link scheme for Tome (#53).
//
// The agent authors in-wiki links as `tome://<path>` (same project), and we
// also tolerate bare relative `*.md` links from older content. Both resolve to
// a same-project page and route through SPA navigation instead of a raw browser
// href (which would break relative to the current route). External `https://`
// links are left alone.
//
// Cross-project (`tome://<project>/<path>`) is deferred to the #65 resolver —
// without it we can't disambiguate a project slug from a folder segment — so
// for now everything after `tome://` is treated as a same-project path.

export interface TomeLinkTarget {
  /** Same-project wiki page path, e.g. `overview.md`, `repos/mycelium/status.md`. */
  path: string;
}

/**
 * Parse an href into a same-project wiki target, or `null` if it's not an
 * internal wiki link (external URL, mailto, in-page anchor, etc.).
 */
export function parseTomeHref(href: string): TomeLinkTarget | null {
  if (!href) return null;
  const raw = href.trim();

  if (raw.startsWith("tome://")) {
    const path = normalizePath(raw.slice("tome://".length));
    return path ? { path } : null;
  }

  // Best-effort: a bare relative markdown link (no scheme, not an absolute
  // path or in-page anchor) — treat as a same-project page.
  if (
    !/^[a-z][a-z0-9+.-]*:/i.test(raw) && // no scheme (http:, mailto:, tome:, …)
    !raw.startsWith("/") &&
    !raw.startsWith("#") &&
    /\.md(#.*)?$/i.test(raw)
  ) {
    const path = normalizePath(raw);
    return path ? { path } : null;
  }

  return null;
}

/** Strip a leading `./` and any surrounding slashes from a wiki path. */
function normalizePath(path: string): string {
  return path.replace(/^\.?\/+/, "").replace(/^\/+/, "").trim();
}

/** The full SPA route for a same-project wiki page (fallback href / cross-tab). */
export function wikiRoute(slug: string, path: string): string {
  return `/projects/${slug}/tome/wiki/${path}`;
}
