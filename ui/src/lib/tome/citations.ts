// Ported from tiny-teams-with-tokens `frontend/lib/citations.ts`.
// Classifies GitHub citation-shaped links so the Crepe editor can render them
// as styled chips (commit / issue / PR / release / mention). Self-contained.
//
// NOTE: TTT's renderer-side `resolveCitations()` (rewrites bare `[issue #142]`
// etc. into real links) will be ported alongside the ingest/render path; for
// the editor we only need `classifyCitationHref`.

export type CitationKind = "issue" | "pr" | "commit" | "release" | "mention";

export type CitationInfo = {
  kind: CitationKind;
  label: string; // e.g. "#142", "abc1234", "@alice"
  repo?: string; // owner/name (for repo-scoped kinds)
  handle?: string; // GitHub handle (for mentions)
};

/**
 * Classify a URL as a citation if it points at a GitHub issue / PR / commit /
 * release / user. Returns `null` for non-citation URLs. Used by the Crepe
 * `linkAttr` hook to inject chip classes on rendered <a> tags.
 */
export function classifyCitationHref(href: string): CitationInfo | null {
  const repoMatch = href.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(issues|pull|commit|releases\/tag)\/([^?#/]+)/i,
  );
  if (repoMatch) {
    const [, repo, kindRaw, ref] = repoMatch;
    if (kindRaw === "issues") return { kind: "issue", label: `#${ref}`, repo };
    if (kindRaw === "pull") return { kind: "pr", label: `#${ref}`, repo };
    if (kindRaw === "commit") return { kind: "commit", label: ref.slice(0, 7), repo };
    if (kindRaw === "releases/tag") return { kind: "release", label: ref, repo };
  }
  // GitHub user profile: github.com/<handle> with no further path. Handles
  // are alnum+hyphen, ≤39 chars. Excludes anything followed by `/`.
  const userMatch = href.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/?(?:[?#]|$)/,
  );
  if (userMatch) {
    const handle = userMatch[1];
    return { kind: "mention", label: `@${handle}`, handle };
  }
  return null;
}
