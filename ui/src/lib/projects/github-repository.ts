import type { GitHubRepositorySource } from "@/types/projects";

const PICKER_PREFIX = "github-repo:";
const GITHUB_URL_PREFIX = /^https?:\/\/(?:www\.)?github\.com\//i;

/** Normalize a GitHub URL or `owner/name` reference into `owner/name`. */
export function githubFullName(value: string): string {
  return value
    .trim()
    .replace(GITHUB_URL_PREFIX, "")
    .replace(/[?#].*$/, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

export function githubHtmlUrl(fullName: string): string {
  return `https://github.com/${githubFullName(fullName)}`;
}

/** Best-effort structured source for legacy/manual repository values. */
export function githubSourceFromValue(value: string): GitHubRepositorySource {
  const fullName = githubFullName(value);
  return {
    full_name: fullName,
    html_url: githubHtmlUrl(fullName),
  };
}

/** Picker-only encoding that carries the stable metadata through string[] UI APIs. */
export function encodeGitHubPickerValue(source: GitHubRepositorySource): string {
  return `${PICKER_PREFIX}${encodeURIComponent(JSON.stringify(source))}`;
}

/** Decode a picker value; legacy/manual strings remain fully supported. */
export function decodeGitHubPickerValue(value: string): GitHubRepositorySource {
  if (value.startsWith(PICKER_PREFIX)) {
    try {
      const parsed = JSON.parse(
        decodeURIComponent(value.slice(PICKER_PREFIX.length)),
      ) as Partial<GitHubRepositorySource>;
      if (typeof parsed.full_name === "string" && parsed.full_name.trim()) {
        const fullName = githubFullName(parsed.full_name);
        return {
          ...(typeof parsed.id === "number" && Number.isSafeInteger(parsed.id)
            ? { id: parsed.id }
            : {}),
          ...(typeof parsed.node_id === "string" && parsed.node_id.trim()
            ? { node_id: parsed.node_id.trim() }
            : {}),
          full_name: fullName,
          html_url:
            typeof parsed.html_url === "string" && parsed.html_url.trim()
              ? parsed.html_url.trim()
              : githubHtmlUrl(fullName),
          ...(typeof parsed.default_branch === "string" &&
          parsed.default_branch.trim()
            ? { default_branch: parsed.default_branch.trim() }
            : {}),
        };
      }
    } catch {
      // Fall through to legacy/manual parsing.
    }
  }
  return githubSourceFromValue(value);
}

/** Stable picker/deduplication key, preferring GitHub's immutable numeric ID. */
export function githubSourceKey(source: GitHubRepositorySource): string {
  return typeof source.id === "number"
    ? `id:${source.id}`
    : `name:${githubFullName(source.full_name).toLowerCase()}`;
}

/** Safe slug used by Tome's `repos/<slug>/` page paths. */
export function githubRepoSlug(source: GitHubRepositorySource): string {
  const parts = githubFullName(source.full_name).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Validate and normalize untrusted API/PATCH input. */
export function normalizeGitHubRepositorySource(
  value: unknown,
): GitHubRepositorySource | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GitHubRepositorySource>;
  const fullName =
    typeof candidate.full_name === "string"
      ? githubFullName(candidate.full_name)
      : "";
  if (!fullName || !fullName.includes("/")) return null;
  return {
    ...(typeof candidate.id === "number" && Number.isSafeInteger(candidate.id)
      ? { id: candidate.id }
      : {}),
    ...(typeof candidate.node_id === "string" && candidate.node_id.trim()
      ? { node_id: candidate.node_id.trim() }
      : {}),
    full_name: fullName,
    html_url:
      typeof candidate.html_url === "string" && candidate.html_url.trim()
        ? candidate.html_url.trim()
        : githubHtmlUrl(fullName),
    ...(typeof candidate.default_branch === "string" &&
    candidate.default_branch.trim()
      ? { default_branch: candidate.default_branch.trim() }
      : {}),
  };
}
