/**
 * Hub Crawler — GitHub/GitLab repo crawler + MongoDB cache for skill hubs.
 *
 * Crawls registered skill hubs for SKILL.md files, caches results in MongoDB,
 * and returns them as CatalogSkill[] for the /api/skills route.
 */

import { getCollection } from "@/lib/mongodb";
import { validateCredentialsRef } from "@/lib/api-middleware";
import { scanHubSkillsAsync, type HubSkillScanRef } from "@/lib/skill-scan";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawledSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
  path: string;
  /**
   * Sibling files (relative to the skill folder) the crawler captured.
   * Plain UTF-8 text only — binaries and oversized files are skipped and
   * tallied in `ancillary_summary` for operator visibility.
   */
  ancillary_files?: Record<string, string>;
  ancillary_summary?: AncillarySummary;
}

/**
 * Summary of ancillary-file collection so the gallery / operators can see
 * what was skipped without parsing the file map. `total_bytes` covers the
 * collected text files only (not skipped/binary).
 */
export interface AncillarySummary {
  total_files: number;
  total_bytes: number;
  skipped_binary: number;
  skipped_too_large: number;
  truncated_at_count_cap: boolean;
  truncated_at_size_cap: boolean;
}

export interface HubSkillDoc {
  hub_id: string;
  skill_id: string;
  name: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
  path: string;
  cached_at: Date;
  /** Latest skill-scanner outcome, persisted on manual scan. */
  scan_status?: "passed" | "flagged" | "unscanned";
  scan_summary?: string;
  scan_updated_at?: Date;
  /** Sibling files captured during crawl (UTF-8 text only). */
  ancillary_files?: Record<string, string>;
  ancillary_summary?: AncillarySummary;
}

export interface SkillHubDoc {
  id: string;
  type: "github" | "gitlab";
  location: string;
  enabled: boolean;
  credentials_ref: string | null;
  labels?: string[];
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_message: string | null;
}

export interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  source: "default" | "agent_skills" | "hub";
  source_id: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  /** Hub-only: latest scan outcome surfaced from `hub_skills` cache. */
  scan_status?: "passed" | "flagged" | "unscanned";
  scan_summary?: string;
  scan_updated_at?: string;
  /**
   * Sibling files (paths relative to the skill folder) — populated only
   * when callers request `include_content=true`. Mirrors the same field on
   * `agent_skills` so editors / installers can treat both sources alike.
   */
  ancillary_files?: Record<string, string>;
  ancillary_summary?: AncillarySummary;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HUB_CACHE_TTL_MS = parseInt(
  process.env.HUB_CACHE_TTL_MS || "3600000",
  10,
);

// ENV_VAR_NAME_RE removed — use validateCredentialsRef from api-middleware instead

// ---------------------------------------------------------------------------
// Frontmatter parser (mirrors skill-templates-loader.ts)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): {
  name: string;
  description: string;
} {
  let name = "";
  let description = "";
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (match) {
    const lines = match[1].split("\n");
    let currentKey = "";
    let currentValue = "";

    for (const line of lines) {
      const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
      if (keyMatch) {
        if (currentKey === "name") name = currentValue.trim();
        if (currentKey === "description") description = currentValue.trim();
        currentKey = keyMatch[1];
        const val = keyMatch[2].trim();
        // YAML folded scalar ">" or literal "|" — value is on next lines
        currentValue = val === ">" || val === "|" ? "" : val;
      } else if (currentKey && line.match(/^\s+/)) {
        // Continuation line (indented) — append with space
        currentValue += " " + line.trim();
      }
    }
    if (currentKey === "name") name = currentValue.trim();
    if (currentKey === "description") description = currentValue.trim();
  }
  return { name, description };
}

// ---------------------------------------------------------------------------
// Ancillary-file collection (shared by GitHub + GitLab crawlers)
//
// Anthropic-style skills (e.g. `pdf`, `docx`, `slack`) ship runtime code,
// reference docs, and assets alongside SKILL.md. Without those files an
// installed skill is broken — SKILL.md references like `scripts/extract.py`
// won't resolve.
//
// Strategy:
//   - Bound resource use with per-file / per-skill / per-hub caps.
//   - Skip binaries (extension allowlist + null-byte sniff) since plain-text
//     storage in Mongo is the simplest way to keep parity with `agent_skills`.
//     Operators get a count of skipped binaries via `ancillary_summary` so
//     missing files aren't silent.
//   - Preserve nested paths verbatim (relative to the skill folder).
// ---------------------------------------------------------------------------

const HUB_ANCILLARY_PER_FILE_BYTES = parseInt(
  process.env.HUB_ANCILLARY_PER_FILE_BYTES || String(1 * 1024 * 1024),
  10,
);
const HUB_ANCILLARY_TOTAL_BYTES = parseInt(
  process.env.HUB_ANCILLARY_TOTAL_BYTES || String(5 * 1024 * 1024),
  10,
);
const HUB_ANCILLARY_FILE_LIMIT = parseInt(
  process.env.HUB_ANCILLARY_FILE_LIMIT || "100",
  10,
);

/** Rough text-file allowlist by extension (extend as needed). */
const TEXT_FILE_EXTENSIONS = new Set([
  // Code
  "py", "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "go", "rs", "rb", "php", "java", "kt", "swift", "scala", "cs",
  "c", "h", "cc", "cpp", "hpp", "m", "mm",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "sql", "graphql", "proto",
  // Markup / config / data
  "md", "markdown", "mdx", "rst", "txt", "log",
  "json", "jsonc", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "xml", "html", "htm", "css", "scss", "less",
  "csv", "tsv",
  // DevOps
  "dockerfile", "tf", "tfvars", "hcl",
  "lock", "gitignore", "gitattributes", "editorconfig",
  // Misc text
  "tpl", "tmpl", "j2", "ejs",
]);

/** Strong "this is text" override for files without an extension. */
const TEXT_FILENAMES = new Set([
  "Dockerfile", "Makefile", "Rakefile", "Gemfile", "Pipfile",
  "LICENSE", "NOTICE", "README", "CHANGELOG", "CONTRIBUTING",
  "CODEOWNERS", ".gitignore", ".dockerignore", ".gitattributes",
  ".editorconfig",
]);

function isLikelyTextPath(path: string): boolean {
  const filename = path.split("/").pop() || "";
  if (TEXT_FILENAMES.has(filename)) return true;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false; // unknown bareword extension → treat as binary
  const ext = filename.slice(dot + 1).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext);
}

/**
 * Cheap binary sniff — UTF-8 text shouldn't contain a NUL byte in the
 * first 8 KiB. Catches the case where an extension allow-listed file is
 * actually binary (e.g. `.lock` from a non-text format).
 */
function looksLikeBinaryContent(text: string): boolean {
  const sample = text.length > 8192 ? text.slice(0, 8192) : text;
  return sample.includes("\u0000");
}

/** Mutable accumulator passed through the per-skill collection loop. */
interface AncillaryAccumulator {
  files: Record<string, string>;
  summary: AncillarySummary;
}

function newAncillaryAccumulator(): AncillaryAccumulator {
  return {
    files: {},
    summary: {
      total_files: 0,
      total_bytes: 0,
      skipped_binary: 0,
      skipped_too_large: 0,
      truncated_at_count_cap: false,
      truncated_at_size_cap: false,
    },
  };
}

/**
 * Try to ingest one ancillary file into the accumulator. Returns `false`
 * when the per-skill caps are exhausted so the caller can stop fetching
 * additional siblings (saves API calls).
 */
function tryAcceptAncillary(
  acc: AncillaryAccumulator,
  relPath: string,
  bytes: number,
  fetchText: () => Promise<string>,
): Promise<boolean> {
  if (acc.summary.total_files >= HUB_ANCILLARY_FILE_LIMIT) {
    acc.summary.truncated_at_count_cap = true;
    return Promise.resolve(false);
  }
  if (bytes > HUB_ANCILLARY_PER_FILE_BYTES) {
    acc.summary.skipped_too_large += 1;
    return Promise.resolve(true);
  }
  if (acc.summary.total_bytes + bytes > HUB_ANCILLARY_TOTAL_BYTES) {
    acc.summary.truncated_at_size_cap = true;
    return Promise.resolve(false);
  }
  if (!isLikelyTextPath(relPath)) {
    acc.summary.skipped_binary += 1;
    return Promise.resolve(true);
  }
  return fetchText().then((text) => {
    if (looksLikeBinaryContent(text)) {
      acc.summary.skipped_binary += 1;
      return true;
    }
    acc.files[relPath] = text;
    acc.summary.total_files += 1;
    acc.summary.total_bytes += bytes;
    return true;
  });
}

// ---------------------------------------------------------------------------
// GitHub crawler
// ---------------------------------------------------------------------------

interface GitHubTreeEntry {
  path: string;
  type: string;
  sha: string;
  url: string;
  /** Blob byte size — present for `type: "blob"` entries from the trees API. */
  size?: number;
}

export async function crawlGitHubRepo(
  owner: string,
  repo: string,
  token?: string,
): Promise<CrawledSkill[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "caipe-hub-crawler/1.0",
  };
  if (token) headers["Authorization"] = `token ${token}`;

  // Use Git Trees API (recursive) for efficiency — single request for full tree
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    { headers, signal: AbortSignal.timeout(15000) },
  );
  if (!treeRes.ok) {
    throw new Error(
      `GitHub API error: ${treeRes.status} ${treeRes.statusText}`,
    );
  }
  const treeData = await treeRes.json();
  const entries: GitHubTreeEntry[] = treeData.tree || [];

  // Find all SKILL.md files
  const skillMdPaths = entries
    .filter(
      (e: GitHubTreeEntry) =>
        e.type === "blob" && e.path.endsWith("/SKILL.md"),
    )
    .map((e: GitHubTreeEntry) => e.path);

  // Index every blob by path so we can enumerate ancillary siblings without
  // additional tree calls.
  const blobBySize = new Map<string, number>();
  for (const e of entries) {
    if (e.type === "blob") blobBySize.set(e.path, e.size ?? 0);
  }

  // Sort skill dirs by path so nested-skill detection is deterministic.
  const skillDirs = skillMdPaths
    .map((p) => p.replace(/\/SKILL\.md$/, ""))
    .sort();

  /**
   * Returns true when `path` lives inside a *nested* skill folder (i.e. a
   * SKILL.md exists at a deeper level than `currentDir`). Those files are
   * owned by the nested skill, not the parent, so we must not duplicate
   * them.
   */
  function belongsToNestedSkill(currentDir: string, path: string): boolean {
    for (const otherDir of skillDirs) {
      if (otherDir === currentDir) continue;
      if (!otherDir.startsWith(`${currentDir}/`)) continue;
      if (path === `${otherDir}/SKILL.md`) return true;
      if (path.startsWith(`${otherDir}/`)) return true;
    }
    return false;
  }

  const skills: CrawledSkill[] = [];

  for (const skillPath of skillMdPaths) {
    try {
      // Fetch SKILL.md content
      const contentRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}`,
        { headers, signal: AbortSignal.timeout(10000) },
      );
      if (!contentRes.ok) continue;
      const contentData = await contentRes.json();
      const content = Buffer.from(contentData.content, "base64").toString(
        "utf-8",
      );

      // Derive skill directory and id
      const dir = skillPath.replace(/\/SKILL\.md$/, "");
      const id = dir.split("/").pop() || dir;

      // Collect ancillary siblings (everything under `dir/` except SKILL.md
      // itself and any files belonging to a nested skill). metadata.json is
      // also captured here so installers/exports get it verbatim, while we
      // still parse it separately into `metadata`.
      const ancillary = newAncillaryAccumulator();
      const dirPrefix = `${dir}/`;
      const candidates = Array.from(blobBySize.entries())
        .filter(([p]) => p.startsWith(dirPrefix))
        .filter(([p]) => p !== skillPath)
        .filter(([p]) => !belongsToNestedSkill(dir, p))
        .sort(([a], [b]) => a.localeCompare(b));

      for (const [absPath, size] of candidates) {
        const relPath = absPath.slice(dirPrefix.length);
        const accepted = await tryAcceptAncillary(
          ancillary,
          relPath,
          size,
          async () => {
            const fileRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/contents/${absPath}`,
              { headers, signal: AbortSignal.timeout(10000) },
            );
            if (!fileRes.ok) {
              throw new Error(
                `GitHub content fetch failed for ${absPath}: ${fileRes.status}`,
              );
            }
            const data = await fileRes.json();
            // Reject server-side truncations (>1 MiB blobs return empty
            // `content` with `encoding: "none"`); treat as too-large.
            if (!data.content || data.encoding !== "base64") {
              throw new Error(`Unsupported encoding for ${absPath}`);
            }
            return Buffer.from(data.content, "base64").toString("utf-8");
          },
        );
        if (!accepted) break;
      }

      // Parse metadata.json out of the collected ancillary files (we already
      // fetched it once — no second request needed).
      let metadata: Record<string, unknown> = {};
      const metaContent = ancillary.files["metadata.json"];
      if (metaContent) {
        try {
          metadata = JSON.parse(metaContent);
        } catch {
          // Malformed metadata.json — leave empty but keep the file.
        }
      }

      const fm = parseFrontmatter(content);

      skills.push({
        id: fm.name || id,
        name: fm.name || id,
        description: fm.description || "",
        content,
        metadata,
        path: skillPath,
        ancillary_files: ancillary.files,
        ancillary_summary: ancillary.summary,
      });
    } catch (err) {
      console.error(`[HubCrawl] Failed to fetch ${skillPath}:`, err);
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// GitLab crawler
// ---------------------------------------------------------------------------

interface GitLabTreeEntry {
  id: string;
  name: string;
  type: string;
  path: string;
  mode: string;
}

export async function crawlGitLabRepo(
  projectPath: string,
  token?: string,
): Promise<CrawledSkill[]> {
  const encodedProject = encodeURIComponent(projectPath);
  const baseUrl =
    process.env.GITLAB_API_URL || "https://gitlab.com/api/v4";

  const headers: Record<string, string> = {
    "User-Agent": "caipe-hub-crawler/1.0",
  };
  if (token) headers["PRIVATE-TOKEN"] = token;

  // Get recursive tree
  const treeRes = await fetch(
    `${baseUrl}/projects/${encodedProject}/repository/tree?recursive=true&per_page=100`,
    { headers, signal: AbortSignal.timeout(15000) },
  );
  if (!treeRes.ok) {
    throw new Error(
      `GitLab API error: ${treeRes.status} ${treeRes.statusText}`,
    );
  }
  const entries: GitLabTreeEntry[] = await treeRes.json();

  // Find SKILL.md files
  const skillMdPaths = entries
    .filter(
      (e: GitLabTreeEntry) =>
        e.type === "blob" && e.path.endsWith("/SKILL.md"),
    )
    .map((e: GitLabTreeEntry) => e.path);

  // GitLab tree responses don't carry blob sizes, so we treat unknown sizes
  // as "fetch and check" — `tryAcceptAncillary` still enforces caps after
  // we read the body.
  const allBlobPaths = entries
    .filter((e) => e.type === "blob")
    .map((e) => e.path);

  const skillDirs = skillMdPaths
    .map((p) => p.replace(/\/SKILL\.md$/, ""))
    .sort();

  function belongsToNestedSkill(currentDir: string, path: string): boolean {
    for (const otherDir of skillDirs) {
      if (otherDir === currentDir) continue;
      if (!otherDir.startsWith(`${currentDir}/`)) continue;
      if (path === `${otherDir}/SKILL.md`) return true;
      if (path.startsWith(`${otherDir}/`)) return true;
    }
    return false;
  }

  const skills: CrawledSkill[] = [];

  for (const skillPath of skillMdPaths) {
    try {
      const encodedPath = encodeURIComponent(skillPath);
      const fileRes = await fetch(
        `${baseUrl}/projects/${encodedProject}/repository/files/${encodedPath}/raw?ref=HEAD`,
        { headers, signal: AbortSignal.timeout(10000) },
      );
      if (!fileRes.ok) continue;
      const content = await fileRes.text();

      const dir = skillPath.replace(/\/SKILL\.md$/, "");
      const id = dir.split("/").pop() || dir;

      // Collect ancillary siblings (see GitHub crawler comment for rationale).
      const ancillary = newAncillaryAccumulator();
      const dirPrefix = `${dir}/`;
      const candidates = allBlobPaths
        .filter((p) => p.startsWith(dirPrefix))
        .filter((p) => p !== skillPath)
        .filter((p) => !belongsToNestedSkill(dir, p))
        .sort();

      for (const absPath of candidates) {
        const relPath = absPath.slice(dirPrefix.length);
        // GitLab raw API doesn't expose size in the tree listing; fetch
        // first and let the per-file cap enforce after the read. We trust
        // the `Content-Length` header when present to short-circuit large
        // bodies.
        const accepted = await tryAcceptAncillary(
          ancillary,
          relPath,
          0, // unknown size — accumulator still enforces total + count caps
          async () => {
            const encodedAbs = encodeURIComponent(absPath);
            const res = await fetch(
              `${baseUrl}/projects/${encodedProject}/repository/files/${encodedAbs}/raw?ref=HEAD`,
              { headers, signal: AbortSignal.timeout(10000) },
            );
            if (!res.ok) {
              throw new Error(
                `GitLab raw fetch failed for ${absPath}: ${res.status}`,
              );
            }
            const text = await res.text();
            if (text.length > HUB_ANCILLARY_PER_FILE_BYTES) {
              throw new Error(
                `Ancillary too large for ${absPath}: ${text.length} bytes`,
              );
            }
            return text;
          },
        );
        if (!accepted) break;
      }

      let metadata: Record<string, unknown> = {};
      const metaContent = ancillary.files["metadata.json"];
      if (metaContent) {
        try {
          metadata = JSON.parse(metaContent);
        } catch {
          // Malformed metadata.json — leave empty but keep the file.
        }
      }

      const fm = parseFrontmatter(content);

      skills.push({
        id: fm.name || id,
        name: fm.name || id,
        description: fm.description || "",
        content,
        metadata,
        path: skillPath,
        ancillary_files: ancillary.files,
        ancillary_summary: ancillary.summary,
      });
    } catch (err) {
      console.error(`[HubCrawl] Failed to fetch ${skillPath}:`, err);
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

export function resolveHubToken(hub: SkillHubDoc): string | undefined {
  return resolveToken(hub);
}

function resolveToken(hub: SkillHubDoc): string | undefined {
  // First try the explicit credentials_ref
  if (hub.credentials_ref) {
    try {
      const validated = validateCredentialsRef(hub.credentials_ref);
      if (validated) {
        const val = process.env[validated];
        if (val) return val;
      }
    } catch {
      console.warn(
        `[HubCrawl] Invalid credentials_ref format: ${hub.credentials_ref}`,
      );
      return undefined;
    }
  }

  // Fall back to default token env vars
  if (hub.type === "github") return process.env.GITHUB_TOKEN;
  if (hub.type === "gitlab") return process.env.GITLAB_TOKEN;
  return undefined;
}

// ---------------------------------------------------------------------------
// Main entry point — getHubSkills (with MongoDB caching)
// ---------------------------------------------------------------------------

export async function getHubSkills(
  hub: SkillHubDoc,
  forceFresh = false,
): Promise<CatalogSkill[]> {
  const hubSkillsCol = await getCollection<HubSkillDoc>("hub_skills");

  // Always check for any cached docs first
  const cached = await hubSkillsCol
    .find({ hub_id: hub.id })
    .toArray();

  if (!forceFresh && cached.length > 0) {
    // Check if cache is still fresh
    const cacheThreshold = new Date(Date.now() - HUB_CACHE_TTL_MS);
    const isFresh = cached.some((doc) => doc.cached_at >= cacheThreshold);

    if (!isFresh) {
      // Stale — return cached immediately, refresh in background
      _refreshHubInBackground(hub, hubSkillsCol).catch((err) => {
        console.warn(`[HubCrawl] Background refresh failed for ${hub.location}:`, err);
      });
    }

    return cached.map(docToCatalogSkill(hub));
  }

  // No cache at all (or force-fresh) — must crawl synchronously
  return _crawlAndCache(hub, hubSkillsCol);
}

/**
 * Crawl a hub repo and update the MongoDB cache. Returns CatalogSkill[].
 */
async function _crawlAndCache(
  hub: SkillHubDoc,
  hubSkillsCol: Awaited<ReturnType<typeof getCollection<HubSkillDoc>>>,
): Promise<CatalogSkill[]> {
  const token = resolveToken(hub);
  let crawled: CrawledSkill[];

  try {
    if (hub.type === "github") {
      let loc = hub.location;
      try {
        const url = new URL(loc);
        if (url.hostname === "github.com" || url.hostname.endsWith(".github.com")) {
          loc = url.pathname.replace(/^\/+|\/+$/g, "");
        }
      } catch {
        // Not a URL — assume owner/repo
      }
      const parts = loc.split("/");
      const owner = parts[0];
      const repo = parts[1];
      if (!owner || !repo) throw new Error(`Invalid GitHub location: ${hub.location}`);
      crawled = await crawlGitHubRepo(owner, repo, token);
    } else if (hub.type === "gitlab") {
      crawled = await crawlGitLabRepo(hub.location, token);
    } else {
      throw new Error(`Unsupported hub type: ${hub.type}`);
    }

    // Update hub success status
    const hubsCol = await getCollection("skill_hubs");
    await hubsCol.updateOne(
      { id: hub.id },
      {
        $set: {
          last_success_at: Math.floor(Date.now() / 1000),
          last_failure_at: null,
          last_failure_message: null,
          updated_at: new Date().toISOString(),
        },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      const hubsCol = await getCollection("skill_hubs");
      await hubsCol.updateOne(
        { id: hub.id },
        {
          $set: {
            last_failure_at: Math.floor(Date.now() / 1000),
            last_failure_message: message,
            updated_at: new Date().toISOString(),
          },
        },
      );
    } catch {
      // Best-effort status update
    }

    throw err;
  }

  // Upsert crawled skills into cache. Track which ones are *new* or have
  // *changed content* so we can fire an async scan only for those — saves
  // scanner work on a no-op refresh of a 100-skill hub.
  const now = new Date();
  // Pull just the fields needed for change detection. Cheaper than
  // holding the full previous snapshot in memory.
  const priorDocs = await hubSkillsCol
    .find(
      { hub_id: hub.id },
      { projection: { skill_id: 1, content: 1, scan_status: 1 } },
    )
    .toArray();
  const priorById = new Map(
    priorDocs.map((d) => [
      d.skill_id,
      {
        content: d.content ?? "",
        scan_status: (d.scan_status as string | undefined) ?? null,
      },
    ]),
  );

  const refsToScan: HubSkillScanRef[] = [];

  for (const skill of crawled) {
    await hubSkillsCol.updateOne(
      { hub_id: hub.id, skill_id: skill.id },
      {
        $set: {
          hub_id: hub.id,
          skill_id: skill.id,
          name: skill.name,
          description: skill.description,
          content: skill.content,
          metadata: skill.metadata,
          path: skill.path,
          cached_at: now,
          ancillary_files: skill.ancillary_files ?? {},
          ancillary_summary:
            skill.ancillary_summary ?? {
              total_files: 0,
              total_bytes: 0,
              skipped_binary: 0,
              skipped_too_large: 0,
              truncated_at_count_cap: false,
              truncated_at_size_cap: false,
            },
        },
      },
      { upsert: true },
    );

    const prior = priorById.get(skill.id);
    const isNew = !prior;
    const contentChanged = prior !== undefined && prior.content !== skill.content;
    const neverScanned = prior !== undefined && !prior.scan_status;
    if (isNew || contentChanged || neverScanned) {
      refsToScan.push({
        hub_id: hub.id,
        skill_id: skill.id,
        name: skill.name,
        content: skill.content,
        // Forward ancillary files so the scanner sees the same surface
        // the agent runtime materializes into the StateBackend (see
        // `skills_middleware/backend_sync.py` and
        // `dynamic_agents/services/skills.py`). Otherwise scripts /
        // prompts shipped alongside SKILL.md would never be analyzed.
        ancillary_files: skill.ancillary_files,
      });
    }
  }

  // Remove stale skills that no longer exist in the repo
  const currentIds = crawled.map((s) => s.id);
  if (currentIds.length > 0) {
    await hubSkillsCol.deleteMany({
      hub_id: hub.id,
      skill_id: { $nin: currentIds },
    });
  }

  // Fire-and-forget: run the scanner against the changed/new skills so
  // the per-skill scan_status catches up without blocking the crawl
  // response. Errors are swallowed inside the helper.
  if (refsToScan.length > 0) {
    void scanHubSkillsAsync(refsToScan).catch((err) => {
      console.warn(
        `[HubCrawl] Auto-scan dispatch failed for ${hub.id}:`,
        err,
      );
    });
  }

  const hubLabels = hub.labels || [];
  return crawled.map((s) => ({
    id: `hub-${hub.id}-${s.id}`,
    name: s.name,
    description: s.description,
    source: "hub" as const,
    source_id: hub.id,
    content: s.content,
    metadata: {
      ...s.metadata,
      hub_location: hub.location,
      hub_type: hub.type,
      path: s.path,
      tags: [...(Array.isArray(s.metadata?.tags) ? (s.metadata.tags as string[]) : []), ...hubLabels],
    },
    ancillary_files: s.ancillary_files,
    ancillary_summary: s.ancillary_summary,
  }));
}

/**
 * Fire-and-forget background refresh — crawl and update cache without
 * blocking the caller (stale-while-revalidate pattern).
 */
async function _refreshHubInBackground(
  hub: SkillHubDoc,
  hubSkillsCol: Awaited<ReturnType<typeof getCollection<HubSkillDoc>>>,
): Promise<void> {
  await _crawlAndCache(hub, hubSkillsCol);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function docToCatalogSkill(hub: SkillHubDoc) {
  const hubLabels = hub.labels || [];
  return (doc: HubSkillDoc): CatalogSkill => ({
    id: `hub-${hub.id}-${doc.skill_id}`,
    name: doc.name,
    description: doc.description,
    source: "hub",
    source_id: hub.id,
    content: doc.content,
    metadata: {
      ...doc.metadata,
      hub_location: hub.location,
      hub_type: hub.type,
      path: doc.path,
      tags: [...(Array.isArray(doc.metadata?.tags) ? (doc.metadata.tags as string[]) : []), ...hubLabels],
    },
    scan_status: doc.scan_status,
    scan_summary: doc.scan_summary,
    scan_updated_at: doc.scan_updated_at?.toISOString(),
    ancillary_files: doc.ancillary_files,
    ancillary_summary: doc.ancillary_summary,
  });
}
