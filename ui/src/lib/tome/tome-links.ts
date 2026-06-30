// Internal wiki link scheme for Tome (#53).
//
// The agent authors in-wiki links as `tome://<path>` (same project), and we
// also tolerate bare relative `*.md` links from older content. Both resolve to
// a same-project page and route through SPA navigation instead of a raw browser
// href (which would break relative to the current route). External `https://`
// links are left alone.
//
// Cross-project (`tome://<project>/<path>`) is not resolved here: a project
// slug can't be disambiguated from a folder segment, so everything after
// `tome://` is treated as a same-project path.

export interface TomeLinkTarget {
  /** Same-project wiki page path, e.g. `overview.md`, `repos/mycelium/status.md`. */
  path: string;
  /**
   * Set when the path is a glossary term entry (`glossary/<slug>.md`): the
   * term slug. Glossary links render as inline references with a hover
   * definition, distinct from ordinary page links.
   */
  glossaryTerm?: string;
}

/** Build a target from a resolved path, tagging glossary term entries. */
function toTarget(path: string): TomeLinkTarget | null {
  if (!path) return null;
  const m = path.match(/^glossary\/(.+)\.md$/i);
  return m ? { path, glossaryTerm: m[1] } : { path };
}

/**
 * Parse an href into a same-project wiki target, or `null` if it's not an
 * internal wiki link (external URL, mailto, in-page anchor, etc.).
 */
export function parseTomeHref(href: string): TomeLinkTarget | null {
  if (!href) return null;
  const raw = href.trim();

  if (raw.startsWith("tome://")) {
    return toTarget(normalizePath(raw.slice("tome://".length)));
  }

  // Best-effort: a bare relative markdown link (no scheme, not an absolute
  // path or in-page anchor) — treat as a same-project page.
  if (
    !/^[a-z][a-z0-9+.-]*:/i.test(raw) && // no scheme (http:, mailto:, tome:, …)
    !raw.startsWith("/") &&
    !raw.startsWith("#") &&
    /\.md(#.*)?$/i.test(raw)
  ) {
    return toTarget(normalizePath(raw));
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
