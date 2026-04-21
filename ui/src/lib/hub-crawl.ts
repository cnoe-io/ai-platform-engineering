/**
 * Hub Crawler — GitHub/GitLab repo crawler + MongoDB cache for skill hubs.
 *
 * Crawls registered skill hubs for SKILL.md files, caches results in MongoDB,
 * and returns them as CatalogSkill[] for the /api/skills route.
 */

import { getCollection } from "@/lib/mongodb";
import { validateCredentialsRef } from "@/lib/api-middleware";

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
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HUB_CACHE_TTL_MS = parseInt(
  process.env.HUB_CACHE_TTL_MS || "300000",
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
// GitHub crawler
// ---------------------------------------------------------------------------

interface GitHubTreeEntry {
  path: string;
  type: string;
  sha: string;
  url: string;
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

  // Also find metadata.json files for enrichment
  const metadataPaths = new Set(
    entries
      .filter(
        (e: GitHubTreeEntry) =>
          e.type === "blob" && e.path.endsWith("/metadata.json"),
      )
      .map((e: GitHubTreeEntry) => e.path),
  );

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

      // Try to fetch metadata.json from the same directory
      let metadata: Record<string, unknown> = {};
      const metaPath = `${dir}/metadata.json`;
      if (metadataPaths.has(metaPath)) {
        try {
          const metaRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${metaPath}`,
            { headers, signal: AbortSignal.timeout(10000) },
          );
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            const metaContent = Buffer.from(
              metaData.content,
              "base64",
            ).toString("utf-8");
            metadata = JSON.parse(metaContent);
          }
        } catch {
          // metadata.json is optional
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

  const metadataPaths = new Set(
    entries
      .filter(
        (e: GitLabTreeEntry) =>
          e.type === "blob" && e.path.endsWith("/metadata.json"),
      )
      .map((e: GitLabTreeEntry) => e.path),
  );

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

      let metadata: Record<string, unknown> = {};
      const metaPath = `${dir}/metadata.json`;
      if (metadataPaths.has(metaPath)) {
        try {
          const encodedMetaPath = encodeURIComponent(metaPath);
          const metaRes = await fetch(
            `${baseUrl}/projects/${encodedProject}/repository/files/${encodedMetaPath}/raw?ref=HEAD`,
            { headers, signal: AbortSignal.timeout(10000) },
          );
          if (metaRes.ok) {
            metadata = JSON.parse(await metaRes.text());
          }
        } catch {
          // metadata.json is optional
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

  // Check cache (unless force-fresh)
  if (!forceFresh) {
    const cacheThreshold = new Date(Date.now() - HUB_CACHE_TTL_MS);
    const cached = await hubSkillsCol
      .find({ hub_id: hub.id, cached_at: { $gte: cacheThreshold } })
      .toArray();

    if (cached.length > 0) {
      return cached.map(docToCatalogSkill(hub));
    }
  }

  // Cache miss — crawl the repo
  const token = resolveToken(hub);
  let crawled: CrawledSkill[];

  try {
    if (hub.type === "github") {
      let loc = hub.location;
      // Normalize full URLs to owner/repo
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

    // Update hub status
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
    const message =
      err instanceof Error ? err.message : String(err);

    // Update hub failure status
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

  // Upsert crawled skills into cache
  const now = new Date();
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
        },
      },
      { upsert: true },
    );
  }

  // Remove stale skills that no longer exist in the repo
  const currentIds = crawled.map((s) => s.id);
  if (currentIds.length > 0) {
    await hubSkillsCol.deleteMany({
      hub_id: hub.id,
      skill_id: { $nin: currentIds },
    });
  } else {
    // If crawl returned 0 skills, keep existing cache but don't purge
    // (could be a transient API error with empty response)
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
  }));
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
  });
}
