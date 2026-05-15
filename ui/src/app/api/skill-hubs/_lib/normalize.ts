/**
 * Shared normalization helpers for skill-hubs admin routes.
 *
 * Two distinct concerns live here:
 *
 *  1. URL → `owner/repo` (or `group/.../project`) normalization. GitHub is
 *     flat (`owner/repo`); GitLab supports arbitrary subgroup nesting
 *     (`mycorp/devops/platform`). The previous two-segment truncation
 *     silently corrupted GitLab subgroup hubs (FR-022 / SC-010).
 *
 *  2. `include_paths` validation + normalization for the optional
 *     path-prefix filter on hub crawl (FR-020).
 *
 * Both `POST /api/skill-hubs` and `PATCH /api/skill-hubs/[id]` reuse this
 * module so the two surfaces can never drift.
 */
import { ApiError } from "@/lib/api-error";
import { MAX_TREE_PAGES_HARD_LIMIT } from "@/lib/hub-crawl-constants";

/**
 * Resolve the configured GitLab API host (without scheme/port) so we can
 * recognize a self-hosted GitLab URL the same way we recognize gitlab.com.
 * Falls back to `gitlab.com` when GITLAB_API_URL is unset or unparseable.
 */
function gitlabApiHost(): string {
  const raw = process.env.GITLAB_API_URL;
  if (!raw) return "gitlab.com";
  try {
    return new URL(raw).hostname;
  } catch {
    return "gitlab.com";
  }
}

function isGitHubHost(hostname: string): boolean {
  return (
    hostname === "github.com" ||
    hostname === "www.github.com" ||
    hostname.endsWith(".github.com")
  );
}

function isGitLabHost(hostname: string, configuredHost: string): boolean {
  if (hostname === "gitlab.com" || hostname.endsWith(".gitlab.com")) return true;
  if (configuredHost && hostname === configuredHost) return true;
  if (configuredHost && hostname.endsWith(`.${configuredHost}`)) return true;
  return false;
}

/**
 * Detect the hub provider from a free-form `location` string.
 *
 * Returns:
 *   - `"github"` if `location` is a URL whose host matches the GitHub
 *     allow-list (github.com / *.github.com).
 *   - `"gitlab"` if `location` is a URL whose host matches the GitLab
 *     allow-list (gitlab.com / *.gitlab.com or the configured
 *     `GITLAB_API_URL` host / its subdomains).
 *   - `null` if the input is not a URL, the URL is unparseable, or the
 *     host does not match either provider's allow-list — including
 *     hostname-bypass attempts like `evil-github.com` or
 *     `github.com.attacker.com` (security: NEVER use substring match).
 *
 * The form on the admin Skill Hubs page uses this to detect the
 * "user typed a gitlab URL while the GitHub source is selected"
 * mismatch and auto-switch the source pill, which avoids the
 * confusing `Client error '404 Not Found' for url ... api.github.com/
 * repos/gitlab-org/ai/...` toast that surfaced before this guard
 * existed (the GitHub URL parser in the legacy preview path silently
 * truncated `https://gitlab.com/gitlab-org/ai/skills` to its first
 * two path segments and made a real GitHub API call against
 * `gitlab-org/ai`, which 404s).
 */
export function detectHubProviderFromUrl(
  location: string,
): "github" | "gitlab" | null {
  const trimmed = location.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname;
  if (isGitHubHost(host)) return "github";
  if (isGitLabHost(host, gitlabApiHost())) return "gitlab";
  return null;
}

/**
 * Strip a trailing ``.git`` suffix from the last path segment.
 *
 * The clone-URL form admins copy from GitHub/GitLab UIs ends in
 * ``.git`` (e.g. ``https://gitlab.com/group/project.git``).
 * Both providers' REST APIs reject the literal ``.git`` suffix
 * inside a project path:
 *
 *   - GitHub: ``GET /repos/owner/repo.git/git/trees/HEAD`` →
 *     404 ("repo.git" is treated as a literal repo name and no
 *     such repo exists).
 *
 *   - GitLab: ``GET /projects/group%2Fproject.git/repository/tree``
 *     → 404 (the URL-encoded project path includes the ``.git``
 *     suffix and no project named "project.git" exists).
 *
 * This was the root cause of the reported screenshot bug:
 * pasting ``https://cd.splunkdev.com/kkantesaria/skills-marketplace.git``
 * produced a confusing 404 that sent the operator down a long
 * "is the URL right? scope? subgroup?" debugging path before
 * the trailing ``.git`` was identified as the culprit.
 *
 * Stripped exactly when the FINAL segment ends with ``.git`` --
 * we don't touch intermediate segments because a real repo could
 * legitimately be named ``something.git-stuff`` mid-path.
 */
function stripGitSuffix(segments: readonly string[]): string[] {
  if (segments.length === 0) return [...segments];
  const last = segments[segments.length - 1];
  if (last.endsWith(".git") && last.length > ".git".length) {
    return [...segments.slice(0, -1), last.slice(0, -".git".length)];
  }
  return [...segments];
}

/**
 * Normalize a hub `location` value. Accepts a raw `owner/repo` (or
 * `group/.../project`) string OR a full URL pointing at a github.com /
 * gitlab.com / `GITLAB_API_URL` host.
 *
 *  - GitHub URLs (host matches github.com / *.github.com) are flattened
 *    to `owner/repo` (GitHub's flat repo namespace).
 *  - GitLab URLs (host matches gitlab.com / *.gitlab.com or the
 *    configured GITLAB_API_URL host) preserve **every** path segment
 *    so nested subgroups (`mycorp/devops/platform`) are not silently
 *    truncated. GitLab UI suffixes like `/-/tree/main` are stripped.
 *  - Trailing ``.git`` clone-URL suffix is stripped from the final
 *    segment (see ``stripGitSuffix`` for rationale).
 *  - URLs whose host does not match either provider are returned
 *    unchanged — including hostname-bypass attempts like
 *    `evil-gitlab.com/owner/repo`. The `hubType` parameter is a hint
 *    for callers but is NOT used to bypass the host check (security).
 *  - Non-URL inputs are trimmed and have their trailing ``.git``
 *    stripped (so canonical-form pastes like
 *    ``kkantesaria/skills-marketplace.git`` work too).
 */
export function normalizeHubLocation(
  rawLocation: string,
  hubType: "github" | "gitlab" = "github",
): string {
  // hubType is currently advisory only — every normalization decision
  // below is keyed on the URL host so attackers cannot smuggle a value
  // past the substring/suffix checks by passing a friendly hubType.
  void hubType;

  const loc = rawLocation.trim();
  try {
    const url = new URL(loc);
    const host = url.hostname;
    const rawSegments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    if (rawSegments.length < 2) return loc;

    if (isGitHubHost(host)) {
      // GitHub is flat owner/repo — keep the existing two-segment truncation
      // so `https://github.com/owner/repo/tree/main` collapses correctly.
      // Strip ``.git`` from the repo segment; ``owner.git`` would be
      // unusual but we only ever apply the strip to segments[1].
      const repo = rawSegments[1].endsWith(".git")
        ? rawSegments[1].slice(0, -".git".length)
        : rawSegments[1];
      return `${rawSegments[0]}/${repo}`;
    }

    const glHost = gitlabApiHost();
    if (isGitLabHost(host, glHost)) {
      // GitLab supports arbitrary subgroup nesting — preserve every segment
      // up to the first `-` separator (GitLab's own UI delimiter for routes
      // like `/-/tree/main` that are not part of the project path).
      const dashIdx = rawSegments.indexOf("-");
      const projectSegments = dashIdx >= 0 ? rawSegments.slice(0, dashIdx) : rawSegments;
      if (projectSegments.length >= 2) {
        return stripGitSuffix(projectSegments).join("/");
      }
    }
  } catch {
    // Not a URL — strip trailing .git anyway so canonical-form pastes
    // copied from a clone command (``group/project.git``) work.
    if (loc.endsWith(".git") && loc.length > ".git".length) {
      return loc.slice(0, -".git".length);
    }
  }
  return loc;
}

const INCLUDE_PATH_RE = /^[A-Za-z0-9._\-/]+$/;
const MAX_INCLUDE_PATHS = 20;

/**
 * Validate + normalize an admin-supplied `include_paths` array for a hub.
 * Throws ApiError(400) with a descriptive message on rejection so the
 * route handler can surface it directly.
 *
 * Normalization (per FR-020):
 *  - Reject any entry containing `..`, leading `/`, or characters outside
 *    `[A-Za-z0-9._\-/]`.
 *  - Trim each entry; drop empties.
 *  - Dedupe (preserve order).
 *  - Append a trailing `/` to each entry (so `skills` does not match
 *    `skills-archive/SKILL.md`).
 *  - Cap at 20 entries.
 *
 * Returns `undefined` when the input is absent / empty / fully invalid
 * (caller should omit the field rather than persist `[]`, so existing docs
 * are untouched on PATCH).
 */
export function validateIncludePaths(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ApiError("include_paths must be an array of strings", 400);
  }
  if (value.length > MAX_INCLUDE_PATHS) {
    throw new ApiError(
      `include_paths exceeds the maximum of ${MAX_INCLUDE_PATHS} entries`,
      400,
    );
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new ApiError("include_paths entries must be strings", 400);
    }
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("/")) {
      throw new ApiError(
        `include_paths entry "${trimmed}" must not start with "/"`,
        400,
      );
    }
    if (trimmed.includes("..")) {
      throw new ApiError(
        `include_paths entry "${trimmed}" must not contain ".."`,
        400,
      );
    }
    if (!INCLUDE_PATH_RE.test(trimmed)) {
      throw new ApiError(
        `include_paths entry "${trimmed}" contains disallowed characters (allowed: A-Z a-z 0-9 . _ - /)`,
        400,
      );
    }
    const withSlash = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    if (seen.has(withSlash)) continue;
    seen.add(withSlash);
    out.push(withSlash);
  }

  return out.length > 0 ? out : undefined;
}

/**
 * Validate + clamp an admin-supplied `max_tree_pages` value for a
 * GitLab hub. Each page returns up to 100 entries, so the cap directly
 * shapes how much of a monorepo we walk.
 *
 *  - Accepts numbers and numeric strings; trims surrounding whitespace.
 *  - Rejects negatives, zero, NaN, and non-finite values with a 400.
 *  - Rejects values above {@link MAX_TREE_PAGES_HARD_LIMIT} (currently
 *    500 → 50,000 entries) so a misconfigured admin entry can't make
 *    the Node process walk an unbounded number of pages.
 *  - Returns `undefined` for absent/empty input so callers can omit
 *    the field on PATCH (existing docs untouched).
 *  - Returns `null` only when the caller explicitly passes `null` — the
 *    PATCH route uses that to clear a previously-set value.
 */
export function validateMaxTreePages(
  value: unknown,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    value = Number(trimmed);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(
      "max_tree_pages must be a positive integer",
      400,
    );
  }
  const intValue = Math.floor(value);
  if (intValue <= 0) {
    throw new ApiError(
      "max_tree_pages must be a positive integer",
      400,
    );
  }
  if (intValue > MAX_TREE_PAGES_HARD_LIMIT) {
    throw new ApiError(
      `max_tree_pages exceeds the hard limit of ${MAX_TREE_PAGES_HARD_LIMIT} pages`,
      400,
    );
  }
  return intValue;
}
