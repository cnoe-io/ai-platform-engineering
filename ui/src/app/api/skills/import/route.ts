import { NextRequest } from "next/server";
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  requireRbacPermission,
  successResponse,
  ApiError,
  validateCredentialsRef,
} from "@/lib/api-middleware";

/**
 * POST /api/skills/import
 *
 * Source-agnostic ad-hoc importer for the workspace editor's "Import from
 * repo" panel. Fetches every plain-text file under one or more directory
 * prefixes in a GitHub or GitLab project (excluding `SKILL.md` itself,
 * mirroring `import-github`'s historical behavior) and returns them as a
 * `Record<filename, content>` map for the caller to merge into the skill
 * draft's `ancillary_files`.
 *
 * Replaces the GitHub-only `POST /api/skills/import-github`, which is now
 * a thin proxy that injects `source: "github"`.
 *
 * Request body:
 *   {
 *     source: "github" | "gitlab",
 *     repo:   string,                    // "owner/repo" (GitHub)
 *                                        //   OR "group/.../project" (GitLab)
 *     paths:  string[],                  // 1..5 directory prefixes
 *                                        //   (legacy: `path: string` accepted
 *                                        //    and treated as paths: [path])
 *     credentials_ref?: string           // env-var name resolved via
 *                                        //   validateCredentialsRef
 *   }
 *
 * Response (via successResponse):
 *   {
 *     files:     Record<string, string>,   // filename → utf-8 content
 *     count:     number,                   // === Object.keys(files).length
 *     conflicts: Array<{                   // empty when paths.length <= 1
 *       name: string,                      //   relative filename
 *       kept_from: string,                 //   prefix whose copy won (first)
 *       dropped_from: string,              //   prefix whose copy was discarded
 *     }>,
 *   }
 *
 * Per FR-016, FR-017, FR-018.
 */

const MAX_PATHS = 5;

interface ImportConflict {
  name: string;
  kept_from: string;
  dropped_from: string;
}

interface ImportResult {
  files: Record<string, string>;
  count: number;
  conflicts: ImportConflict[];
}

function normalizeImportPaths(body: Record<string, unknown>): string[] {
  // Accept legacy single-`path` shape transparently (FR-016).
  const rawPaths: unknown[] = Array.isArray(body.paths)
    ? body.paths
    : typeof body.path === "string"
      ? [body.path]
      : [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawPaths) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("/") || trimmed.includes("..")) {
      throw new ApiError(
        `Invalid path "${trimmed}": leading "/" and ".." segments are not allowed`,
        400,
      );
    }
    // Strip the trailing `/` for storage; we add it back at match-time.
    const normalized = trimmed.replace(/\/+$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  if (out.length === 0) {
    throw new ApiError(
      "At least one path is required (use 'paths: [...]' or legacy 'path: ...')",
      400,
    );
  }
  if (out.length > MAX_PATHS) {
    throw new ApiError(
      `Too many paths (${out.length}); the maximum is ${MAX_PATHS}`,
      400,
    );
  }
  return out;
}

/**
 * Merge a per-prefix file map into the cumulative result with first-wins
 * conflict resolution. The same relative filename appearing under two
 * different prefixes lands in `conflicts[]` so the caller can surface a
 * non-blocking toast (FR-018).
 */
function mergeIntoResult(
  result: ImportResult,
  prefix: string,
  files: Record<string, string>,
  // Map of relative-filename → prefix that contributed it (for conflict tracking)
  ownership: Map<string, string>,
): void {
  for (const [name, content] of Object.entries(files)) {
    const prior = ownership.get(name);
    if (prior === undefined) {
      ownership.set(name, prefix);
      result.files[name] = content;
    } else if (prior !== prefix) {
      result.conflicts.push({ name, kept_from: prior, dropped_from: prefix });
    }
    // Same prefix contributing the same name twice (impossible from a
    // single tree fetch but cheap to guard) is silently a no-op.
  }
}

// ---------------------------------------------------------------------------
// GitHub branch
// ---------------------------------------------------------------------------

async function importFromGitHub(
  repo: string,
  paths: string[],
  token: string,
): Promise<ImportResult> {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const treeUrl = `${apiBase}/repos/${repo}/git/trees/HEAD?recursive=1`;
  const treeResp = await fetch(treeUrl, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!treeResp.ok) {
    throw new ApiError(`GitHub tree fetch failed: ${treeResp.status}`, 502);
  }
  const tree = await treeResp.json();

  const result: ImportResult = { files: {}, count: 0, conflicts: [] };
  const ownership = new Map<string, string>();

  for (const dirPath of paths) {
    const prefix = `${dirPath}/`;
    const blobs: string[] = [];
    for (const item of tree.tree ?? []) {
      const p = String(item.path).replace(/\\/g, "/");
      if (item.type === "blob" && p.startsWith(prefix) && !p.endsWith("SKILL.md")) {
        blobs.push(p);
      }
    }

    const files: Record<string, string> = {};
    for (const blobPath of blobs) {
      const rel = blobPath.slice(prefix.length);
      try {
        const contUrl = `${apiBase}/repos/${repo}/contents/${blobPath}`;
        const r = await fetch(contUrl, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) continue;
        const data = await r.json();
        files[rel] = Buffer.from(data.content ?? "", "base64").toString("utf-8");
      } catch {
        // skip files that fail to fetch — don't poison the whole import
      }
    }

    mergeIntoResult(result, dirPath, files, ownership);
  }

  result.count = Object.keys(result.files).length;
  return result;
}

// ---------------------------------------------------------------------------
// GitLab branch
// ---------------------------------------------------------------------------

interface GitLabTreeItem {
  type: string;
  path: string;
}

async function importFromGitLab(
  projectPath: string,
  paths: string[],
  token: string,
): Promise<ImportResult> {
  const apiBase = process.env.GITLAB_API_URL || "https://gitlab.com/api/v4";
  const encodedProject = encodeURIComponent(projectPath);
  const headers: Record<string, string> = {
    "User-Agent": "caipe-skill-importer/1.0",
  };
  // GitLab uses PRIVATE-TOKEN, matching `crawlGitLabRepo`. Public projects
  // work without a token; we only set the header when one is resolved.
  if (token) headers["PRIVATE-TOKEN"] = token;

  // Walk the GitLab tree across pages. Without this loop a project with
  // more than 100 entries would silently truncate (only the first page is
  // returned), the prefix scan would find no blobs, and the importer would
  // succeed with `count: 0`. Mirrors the pagination contract in
  // `crawlGitLabRepo`. The cap is conservative for an inline import flow
  // (50 pages × 100 = 5,000 entries); admins can raise it via env if a
  // monorepo legitimately needs deeper traversal.
  const maxTreePages = (() => {
    const raw = process.env.GITLAB_IMPORT_MAX_TREE_PAGES;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 50;
  })();
  const entries: GitLabTreeItem[] = [];
  let truncatedAtCap = false;
  for (let page = 1; page <= maxTreePages; page += 1) {
    const treeUrl =
      `${apiBase}/projects/${encodedProject}/repository/tree` +
      `?recursive=true&per_page=100&page=${page}`;
    const treeResp = await fetch(treeUrl, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!treeResp.ok) {
      // GitLab returns 404 for unauthenticated reads of private
      // projects, which is misleading — bucket 401/403/404 into the
      // same diagnostic cluster ("can't see this project") and
      // tailor the hint based on whether a token was configured.
      // Mirrors ``formatGitLabFetchError`` in lib/hub-crawl.ts so
      // the two GitLab-tree call sites give consistent operator
      // guidance.
      const apiHost = (() => {
        try {
          return new URL(apiBase).host;
        } catch {
          return apiBase;
        }
      })();
      if (
        treeResp.status === 401 ||
        treeResp.status === 403 ||
        treeResp.status === 404
      ) {
        if (!token) {
          throw new ApiError(
            `GitLab tree fetch failed: ${treeResp.status} (project: ${projectPath}, API: ${apiHost}). ` +
              `No GitLab token is configured. For private or self-hosted projects, ` +
              `set GITLAB_TOKEN to a personal access token with the "read_repository" scope ` +
              `that's valid for ${apiHost}, or pass credentials_ref.`,
            502,
          );
        }
        throw new ApiError(
          `GitLab tree fetch failed: ${treeResp.status} (project: ${projectPath}, API: ${apiHost}). ` +
            `A GitLab token is set, but it does not grant access to this project on ${apiHost}. ` +
            `Verify the token belongs to the same GitLab instance as GITLAB_API_URL, has the ` +
            `"read_repository" scope, and that the user owning it can see the project. For ` +
            `self-hosted GitLab the gitlab.com token will not work — generate one on ${apiHost}.`,
          502,
        );
      }
      if (treeResp.status === 429) {
        throw new ApiError(
          `GitLab tree fetch failed: 429 (project: ${projectPath}, API: ${apiHost}). ` +
            `Rate limited by GitLab. Wait and retry, or use an authenticated token to raise the rate limit.`,
          502,
        );
      }
      throw new ApiError(
        `GitLab tree fetch failed: ${treeResp.status} (project: ${projectPath}, API: ${apiHost})`,
        502,
      );
    }
    // Defensive: if GitLab (or a proxy in front of it) returns a non-JSON
    // body — e.g. an SSO HTML redirect — surface a useful 502 instead of
    // letting `await .json()` throw the opaque
    // ``Unexpected token '<', "<!DOCTYPE "`` to the client.
    const ct = treeResp.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("json")) {
      const preview = await treeResp.text().catch(() => "");
      throw new ApiError(
        `GitLab tree fetch returned non-JSON response ` +
          `(HTTP ${treeResp.status}, Content-Type: ${ct || "unset"}). ` +
          `This usually means a proxy/SSO challenge intercepted the request. ` +
          `Body starts with: ${preview.slice(0, 200)}`,
        502,
      );
    }
    let pageEntries: GitLabTreeItem[];
    try {
      pageEntries = (await treeResp.json()) as GitLabTreeItem[];
    } catch (err) {
      throw new ApiError(
        `GitLab tree response was not parseable JSON: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }
    if (!Array.isArray(pageEntries) || pageEntries.length === 0) break;
    entries.push(...pageEntries);
    if (pageEntries.length < 100) break;
    if (page === maxTreePages) {
      truncatedAtCap = true;
      break;
    }
  }
  if (truncatedAtCap) {
    // Surface truncation as an inline warning in the response. We
    // *don't* fail the import — partial results are better than none —
    // but the caller can show it as a toast.
    // (Future: add a structured `truncation` field to ImportResult.)
    console.warn(
      `[skills/import] GitLab tree for ${projectPath} hit the ${maxTreePages}-page cap; ` +
        `some files may be missing. Raise GITLAB_IMPORT_MAX_TREE_PAGES if needed.`,
    );
  }

  const result: ImportResult = { files: {}, count: 0, conflicts: [] };
  const ownership = new Map<string, string>();

  for (const dirPath of paths) {
    const prefix = `${dirPath}/`;
    const blobs: string[] = [];
    for (const item of entries) {
      if (item.type !== "blob") continue;
      const p = item.path;
      if (p.startsWith(prefix) && !p.endsWith("SKILL.md")) {
        blobs.push(p);
      }
    }

    const files: Record<string, string> = {};
    for (const blobPath of blobs) {
      const rel = blobPath.slice(prefix.length);
      try {
        const encodedBlob = encodeURIComponent(blobPath);
        const rawUrl = `${apiBase}/projects/${encodedProject}/repository/files/${encodedBlob}/raw?ref=HEAD`;
        const r = await fetch(rawUrl, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) continue;
        files[rel] = await r.text();
      } catch {
        // skip files that fail to fetch
      }
    }

    mergeIntoResult(result, dirPath, files, ownership);
  }

  result.count = Object.keys(result.files).length;
  return result;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function runImport(
  body: Record<string, unknown>,
): Promise<ImportResult> {
  const source = body.source;
  if (source !== "github" && source !== "gitlab") {
    throw new ApiError(
      `Invalid 'source': ${String(source)}. Expected "github" or "gitlab".`,
      400,
    );
  }

  const repo =
    typeof body.repo === "string" ? body.repo.trim() : "";
  if (!repo) {
    throw new ApiError("'repo' is required", 400);
  }

  const paths = normalizeImportPaths(body);
  const credentialsRef = validateCredentialsRef(body.credentials_ref);

  // Token resolution mirrors the hub crawler: explicit credentials_ref
  // first (validated), then per-source default env var.
  const explicitToken = credentialsRef
    ? process.env[credentialsRef] ?? ""
    : "";
  const fallbackToken =
    source === "github"
      ? process.env.GITHUB_TOKEN ?? ""
      : process.env.GITLAB_TOKEN ?? "";
  const token = explicitToken || fallbackToken;

  if (source === "github") {
    return await importFromGitHub(repo, paths, token);
  }
  return await importFromGitLab(repo, paths, token);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

  const body = (await request.json()) as Record<string, unknown>;
  const result = await runImport(body);
  return successResponse(result);
});
