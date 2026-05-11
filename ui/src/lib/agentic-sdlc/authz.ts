/**
 * Repo-scoped authorization helpers for the Agentic SDLC.
 *
 * Per spec FR-024: Agentic SDLC relies *exclusively* on the caller's
 * GitHub permissions for HITL actions; there is no internal Ship-Loop
 * role. Concretely:
 *
 *   - any authenticated user with `pull` ⇒ can READ a repo's Agentic SDLC
 *     dashboard.
 *   - `push` (write)                       ⇒ can comment on PRs.
 *   - `admin` or codeowner-mandated review  ⇒ can approve / request
 *     changes / retry deploy / pause-loop.
 *
 * For the MVP we coarsen the mapping to:
 *   - read         → `permissions.pull === true`
 *   - comment/act  → `permissions.push === true`
 *   - admin actions → `permissions.admin === true`
 *
 * The caller's session must carry a usable GitHub OAuth token; we
 * resolve permissions live via `getRepoMetadata`. Results are cached
 * per-user-per-repo for `CACHE_TTL_MS` (default 60s) to keep latency
 * down without letting permission revocations linger.
 *
 * Server-only module.
 */

import {
  GitHubClientError,
  createGitHubClient,
  type IGitHubClient,
} from "@/lib/agentic-sdlc/github-client";

export type AgenticSdlcPermissionLevel =
  | "none"
  | "read"
  | "comment"
  | "admin";

export interface ResolvedRepoPermission {
  level: AgenticSdlcPermissionLevel;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string /* userId:owner/repo */, ResolvedRepoPermission>();

interface ResolveOpts {
  userId: string;
  authToken: string;
  owner: string;
  repo: string;
  /** Inject a pre-built client in tests. */
  clientFactory?: (token: string) => IGitHubClient;
  /** Override TTL in tests. */
  ttlMs?: number;
}

export async function resolveRepoPermission(
  opts: ResolveOpts,
): Promise<AgenticSdlcPermissionLevel> {
  const cacheKey = `${opts.userId}:${opts.owner.toLowerCase()}/${opts.repo.toLowerCase()}`;
  const ttl = opts.ttlMs ?? CACHE_TTL_MS;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.level;
  }

  const client =
    opts.clientFactory?.(opts.authToken) ??
    createGitHubClient({ authToken: opts.authToken });

  let level: AgenticSdlcPermissionLevel = "none";
  try {
    const meta = await client.getRepoMetadata(opts.owner, opts.repo);
    if (meta.permissions?.admin) level = "admin";
    else if (meta.permissions?.push) level = "comment";
    else if (meta.permissions?.pull) level = "read";
    else level = "none";
  } catch (err) {
    if (err instanceof GitHubClientError && err.code === "not_found") {
      level = "none";
    } else if (
      err instanceof GitHubClientError &&
      err.code === "unauthorized"
    ) {
      level = "none";
    } else {
      // Don't cache transient failures.
      throw err;
    }
  }

  cache.set(cacheKey, { level, fetchedAt: Date.now() });
  return level;
}

export function clearRepoPermissionCache(): void {
  cache.clear();
}

export class AgenticSdlcAuthzError extends Error {
  readonly status: 401 | 403 | 404;
  constructor(message: string, status: 401 | 403 | 404) {
    super(message);
    this.name = "AgenticSdlcAuthzError";
    this.status = status;
  }
}

/**
 * Throws `AgenticSdlcAuthzError` if the level isn't sufficient. Returns
 * the resolved level on success.
 *
 * Note: 404 is preferred over 403 for read-level failures so we don't
 * leak repo existence to anonymous attackers (FR-024 + general API
 * security guidance).
 */
export async function requireRepoPermission(
  opts: ResolveOpts,
  required: Exclude<AgenticSdlcPermissionLevel, "none">,
): Promise<AgenticSdlcPermissionLevel> {
  const level = await resolveRepoPermission(opts);
  if (rank(level) >= rank(required)) return level;
  if (level === "none") {
    throw new AgenticSdlcAuthzError("Repo not found or not accessible", 404);
  }
  throw new AgenticSdlcAuthzError(
    `Required GitHub permission '${required}' not granted; have '${level}'.`,
    403,
  );
}

function rank(level: AgenticSdlcPermissionLevel): number {
  switch (level) {
    case "admin":
      return 3;
    case "comment":
      return 2;
    case "read":
      return 1;
    case "none":
      return 0;
  }
}
