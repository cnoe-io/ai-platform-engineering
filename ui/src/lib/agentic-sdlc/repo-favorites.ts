export const AGENTIC_SDLC_FAVORITE_REPOS_STORAGE_KEY =
  "agentic-sdlc-starred-repos";

export function readFavoriteRepos(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(
      AGENTIC_SDLC_FAVORITE_REPOS_STORAGE_KEY,
    );
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeFavoriteRepos(repos: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    AGENTIC_SDLC_FAVORITE_REPOS_STORAGE_KEY,
    JSON.stringify(repos),
  );
}

export function toggleFavoriteRepo(repos: string[], fullName: string): string[] {
  return repos.includes(fullName)
    ? repos.filter((repo) => repo !== fullName)
    : [...repos, fullName];
}
