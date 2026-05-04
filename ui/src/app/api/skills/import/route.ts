import { NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
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

  const treeUrl = `${apiBase}/projects/${encodedProject}/repository/tree?recursive=true&per_page=100`;
  const treeResp = await fetch(treeUrl, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!treeResp.ok) {
    // GitLab returns 404 for unauthenticated reads of private projects,
    // which is misleading. Surface a friendlier hint when no token is set.
    if ((treeResp.status === 404 || treeResp.status === 401 || treeResp.status === 403) && !token) {
      throw new ApiError(
        `GitLab tree fetch failed: ${treeResp.status} (set GITLAB_TOKEN or pass credentials_ref for private projects)`,
        502,
      );
    }
    throw new ApiError(`GitLab tree fetch failed: ${treeResp.status}`, 502);
  }
  const entries: GitLabTreeItem[] = await treeResp.json();

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
  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body = (await request.json()) as Record<string, unknown>;
    const result = await runImport(body);
    return successResponse(result);
  });
});
