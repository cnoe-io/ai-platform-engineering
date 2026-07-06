// Internal wiki link scheme for Tome (#53).
//
// Relative by default, explicit when crossing projects:
//   tome://<path>             same project (e.g. overview.md, glossary/mcp.md)
//   tome://@<project>/<path>  another project, named explicitly. The `@` marks
//                             the project authority so it can't collide with a
//                             folder named like a project.
// We also tolerate bare relative `*.md` links from older content. Internal
// links route through SPA navigation; external `https://` links are left alone.

export interface TomeLinkTarget {
  /**
   * Target project slug for an explicit cross-project ref
   * (`tome://@<project>/<path>`). Undefined = same project (relative).
   */
  project?: string;
  /** Wiki page path, e.g. `overview.md`, `repos/mycelium/status.md`. */
  path: string;
  /**
   * Set when the path is a glossary term entry (`glossary/<slug>.md`): the
   * term slug. Glossary links render as inline references with a hover
   * definition, distinct from ordinary page links.
   */
  glossaryTerm?: string;
}

/** A glossary term's resolved content, shown in the hover definition card. */
export interface GlossaryPreview {
  term: string;
  expansion?: string;
  definition: string;
}

/**
 * Resolves a `tome://` reference (the full href) to a glossary preview. May be
 * async (cross-project `@<project>` refs resolve via the backend) or sync
 * (same-project, already loaded). Returns null when it doesn't resolve.
 */
export type GlossaryResolver = (
  ref: string,
) => GlossaryPreview | null | Promise<GlossaryPreview | null>;

/** Build a target from a resolved path (+ optional project), tagging glossary entries. */
function toTarget(path: string, project?: string): TomeLinkTarget | null {
  if (!path) return null;
  const m = path.match(/^glossary\/(.+)\.md$/i);
  return m ? { project, path, glossaryTerm: m[1] } : { project, path };
}

/**
 * Parse an href into a wiki target, or `null` if it's not an internal wiki link
 * (external URL, mailto, in-page anchor, etc.). `tome://@<project>/<path>`
 * resolves to a named project; bare `tome://<path>` is same-project.
 */
export function parseTomeHref(href: string): TomeLinkTarget | null {
  if (!href) return null;
  const raw = href.trim();

  if (raw.startsWith("tome://")) {
    let rest = raw.slice("tome://".length);
    let project: string | undefined;
    if (rest.startsWith("@")) {
      const slash = rest.indexOf("/");
      if (slash === -1) return null; // @project with no path
      project = rest.slice(1, slash).trim() || undefined;
      rest = rest.slice(slash + 1);
    }
    return toTarget(normalizePath(rest), project);
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

/**
 * A link to one Feed message (#91's promote-to-feed): `tome://@<project>/feed/<id>`.
 * Always carries an explicit `@<project>` — even when it's the chat agent's
 * own project — so resolving it never needs ambient "current project" state,
 * matching how a genuinely cross-project ref already works. Distinct from
 * `TomeLinkTarget` (wiki pages): a Feed message isn't a page, it's a
 * scroll-to target within the Feed view (`?to_message=`).
 */
export interface TomeFeedLinkTarget {
  project: string;
  messageId: string;
}

/** Parse a `tome://@<project>/feed/<id>` reference, or `null` if it isn't one. */
export function parseFeedHref(href: string): TomeFeedLinkTarget | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw.startsWith("tome://@")) return null;
  const rest = raw.slice("tome://@".length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const project = rest.slice(0, slash).trim();
  const m = rest.slice(slash + 1).match(/^feed\/([^/?#]+)\/?$/);
  if (!project || !m) return null;
  return { project, messageId: decodeURIComponent(m[1]) };
}

/** The full SPA route to one Feed message, focused and scrolled to on load. */
export function feedMessageRoute(slug: string, messageId: string): string {
  return `/projects/${slug}/tome/feed?to_message=${encodeURIComponent(messageId)}`;
}
