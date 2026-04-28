import { NextRequest, NextResponse } from "next/server";
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
} from "@/lib/api-middleware";
import { applySkillsCatalogQueryToBackendUrl } from "@/lib/skills-catalog-query";
import type { SkillHubDoc } from "@/lib/hub-crawl";

/**
 * Skills Catalog API — Single source of truth for UI and assistant (FR-001).
 *
 * GET /api/skills
 *   Returns the merged skill catalog from default (filesystem) + agent_skills + hubs.
 *   If NEXT_PUBLIC_A2A_BASE_URL is configured, proxies to the Python backend GET /skills.
 *   Otherwise, aggregates locally from /api/skill-templates and /api/agent-skills.
 *
 * Supports dual-auth: Bearer JWT (for CLI/remote) or NextAuth session (browser).
 *
 * Query params:
 *   q               — case-insensitive text search in skill name and description
 *   source          — filter by source: "default", "agent_skills", "hub", "github", "gitlab"
 *   repo            — filter hub skills by repository location (e.g. "owner/repo")
 *   tags            — comma-separated tag filter (metadata.tags includes any)
 *   include_content — include full SKILL.md body for each skill (default false)
 *   page            — page number, 1-indexed (default: omit for all results)
 *   page_size       — items per page, 1-100 (default: 50)
 *   visibility      — optional: global | team | personal (entitled subset filter)
 *
 * Response shape per contracts/catalog-api.md:
 *   { skills: [...], meta: { total, page, page_size, has_more, sources_loaded, unavailable_sources } }
 *
 * Error responses:
 *   401 — unauthorized
 *   503 — { error: "skills_unavailable", message: "..." }
 */

interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  source: "default" | "agent_skills" | "hub";
  source_id: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
}

interface CatalogResponse {
  skills: CatalogSkill[];
  meta: {
    total: number;
    page?: number;
    page_size?: number;
    has_more?: boolean;
    sources_loaded: string[];
    unavailable_sources: string[];
  };
}

interface QueryParams {
  q: string;
  source: string;
  repo: string;
  visibility: string;
  tags: string[];
  includeContent: boolean;
  page: number | null; // null = no pagination
  pageSize: number;
}

function parseQueryParams(req: NextRequest): QueryParams {
  const sp = new URL(req.url).searchParams;
  const rawPage = sp.get("page");
  const rawPageSize = sp.get("page_size");

  let page: number | null = null;
  if (rawPage !== null) {
    page = Math.max(1, parseInt(rawPage, 10) || 1);
  }

  let pageSize = 50;
  if (rawPageSize !== null) {
    pageSize = Math.min(100, Math.max(1, parseInt(rawPageSize, 10) || 50));
  }

  const rawTags = sp.get("tags") || "";
  const tags = rawTags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  return {
    q: (sp.get("q") || "").trim().toLowerCase(),
    source: (sp.get("source") || "").trim().toLowerCase(),
    repo: (sp.get("repo") || "").trim().toLowerCase(),
    visibility: (sp.get("visibility") || "").trim().toLowerCase(),
    tags,
    includeContent: sp.get("include_content") === "true",
    page,
    pageSize,
  };
}

/**
 * Apply in-memory filters to a skill list.
 */
function filterSkills(
  skills: CatalogSkill[],
  params: QueryParams,
): CatalogSkill[] {
  let result = skills;

  if (params.q) {
    result = result.filter(
      (s) =>
        s.name.toLowerCase().includes(params.q) ||
        s.description.toLowerCase().includes(params.q),
    );
  }

  if (params.source) {
    if (params.source === "github" || params.source === "gitlab") {
      result = result.filter(
        (s) =>
          s.source === "hub" &&
          (s.metadata as { hub_type?: string })?.hub_type === params.source,
      );
    } else {
      result = result.filter(
        (s) => s.source.toLowerCase() === params.source,
      );
    }
  }

  if (params.visibility) {
    const v = params.visibility;
    result = result.filter((s) => {
      const mv = (s.metadata as { visibility?: string })?.visibility;
      return (mv || "global").toLowerCase() === v;
    });
  }

  if (params.repo) {
    result = result.filter((s) => {
      const loc = (s.metadata as { hub_location?: string })?.hub_location;
      return loc ? loc.toLowerCase() === params.repo : false;
    });
  }

  if (params.tags.length > 0) {
    result = result.filter((s) => {
      const skillTags: string[] = Array.isArray(s.metadata?.tags)
        ? (s.metadata.tags as string[]).map((t) => t.toLowerCase())
        : [];
      return params.tags.some((t) => skillTags.includes(t));
    });
  }

  return result;
}

/**
 * Apply pagination to a filtered skill list and build the response meta.
 */
function paginate(
  skills: CatalogSkill[],
  params: QueryParams,
  baseMeta: { sources_loaded: string[]; unavailable_sources: string[] },
): CatalogResponse {
  const total = skills.length;

  // No pagination requested — backward compatible (return all)
  if (params.page === null) {
    return {
      skills,
      meta: { total, ...baseMeta },
    };
  }

  const start = (params.page - 1) * params.pageSize;
  const paged = skills.slice(start, start + params.pageSize);

  return {
    skills: paged,
    meta: {
      total,
      page: params.page,
      page_size: params.pageSize,
      has_more: start + params.pageSize < total,
      ...baseMeta,
    },
  };
}

/**
 * Try to proxy to the Python backend at NEXT_PUBLIC_A2A_BASE_URL.
 * Returns null if not configured or unreachable.
 * Forwards query params so the backend can also filter server-side.
 */
async function fetchFromBackend(
  params: QueryParams,
  authHeader?: string | null,
): Promise<CatalogResponse | null> {
  const backendUrl = process.env.NEXT_PUBLIC_A2A_BASE_URL;
  if (!backendUrl) return null;

  try {
    const url = new URL("/skills", backendUrl);
    const incoming = new URLSearchParams();
    if (params.includeContent) incoming.set("include_content", "true");
    if (params.q) incoming.set("q", params.q);
    if (params.source) incoming.set("source", params.source);
    if (params.repo) incoming.set("repo", params.repo);
    if (params.visibility) incoming.set("visibility", params.visibility);
    if (params.tags.length > 0) incoming.set("tags", params.tags.join(","));
    if (params.page !== null) {
      incoming.set("page", String(params.page));
      incoming.set("page_size", String(params.pageSize));
    }
    applySkillsCatalogQueryToBackendUrl(url, incoming);

    const headers: Record<string, string> = {};
    if (authHeader) headers["Authorization"] = authHeader;

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as CatalogResponse;
  } catch {
    return null;
  }
}

/**
 * Local aggregation fallback: merge skill-templates (filesystem) and
 * agent-skills (MongoDB) into a single catalog.
 */
async function aggregateLocally(
  includeContent: boolean,
): Promise<CatalogResponse> {
  const skills: CatalogSkill[] = [];
  const sourcesLoaded: string[] = [];
  const unavailableSources: string[] = [];

  // 1. Skill templates (filesystem / SKILLS_DIR)
  try {
    const { loadSkillTemplatesInternal } = await import(
      "./skill-templates-loader"
    );
    const templates = loadSkillTemplatesInternal();
    for (const t of templates) {
      const meta: Record<string, unknown> = {
        category: t.category,
        icon: t.icon,
        tags: t.tags,
      };
      if (t.input_variables && t.input_variables.length > 0) {
        meta.input_variables = t.input_variables;
      }
      skills.push({
        id: t.id,
        name: t.name,
        description: t.description,
        source: "default",
        source_id: null,
        content: includeContent ? t.content : null,
        metadata: meta,
      });
    }
    sourcesLoaded.push("default");
  } catch (err) {
    console.error("[Skills] Failed to load skill templates:", err);
    unavailableSources.push("default");
  }

  // 2. Agent skills (MongoDB) — match any content field
  try {
    const { getCollection, isMongoDBConfigured } = await import(
      "@/lib/mongodb"
    );
    if (isMongoDBConfigured) {
      const collection = await getCollection("agent_skills");
      const docs = await collection
        .find(
          {
            $or: [
              { skill_content: { $exists: true, $ne: "" } },
              { skill_template: { $exists: true, $ne: "" } },
              { "tasks.0.llm_prompt": { $exists: true, $ne: "" } },
            ],
          },
          {
            projection: {
              _id: 0,
              id: 1,
              name: 1,
              description: 1,
              skill_content: 1,
              skill_template: 1,
              tasks: 1,
              owner_id: 1,
              visibility: 1,
              is_system: 1,
              category: 1,
              metadata: 1,
            },
          },
        )
        .toArray();

      for (const doc of docs) {
        if (!doc.name || !doc.description) continue;
        const content =
          doc.skill_content || doc.skill_template || doc.tasks?.[0]?.llm_prompt || "";
        skills.push({
          id: String(doc.id || doc.name),
          name: String(doc.name),
          description: String(doc.description).slice(0, 1024),
          source: "agent_skills",
          source_id: doc.owner_id ?? null,
          content: includeContent ? content : null,
          metadata: {
            ...doc.metadata,
            category: doc.category,
            visibility: doc.visibility,
            is_system: doc.is_system,
          },
        });
      }
      sourcesLoaded.push("agent_skills");
    }
  } catch (err) {
    console.error("[Skills] Failed to load agent_skills:", err);
    unavailableSources.push("agent_skills");
  }

  // 3. Hub skills (GitHub / GitLab)
  try {
    const { getCollection: getCol, isMongoDBConfigured: mongoOk } = await import(
      "@/lib/mongodb"
    );
    if (mongoOk) {
      const { getHubSkills } = await import("@/lib/hub-crawl");
      const hubsCol = await getCol<SkillHubDoc>("skill_hubs");
      const enabledHubs = await hubsCol.find({ enabled: true }).toArray();
      for (const hub of enabledHubs) {
        try {
          const hubSkills = await getHubSkills(hub);
          skills.push(...hubSkills);
          sourcesLoaded.push(`hub:${hub.id}`);
        } catch (err) {
          console.error(`[Skills] Hub ${hub.location} failed:`, err);
          unavailableSources.push(`hub:${hub.id}`);
        }
      }
    }
  } catch {
    // Hub loading is best-effort
  }

  // Apply precedence: default wins over agent_skills (by name)
  const merged = new Map<string, CatalogSkill>();
  const priority: Record<string, number> = {
    default: 0,
    agent_skills: 1,
    hub: 2,
  };
  for (const skill of skills) {
    const existing = merged.get(skill.name);
    if (!existing || priority[skill.source] < priority[existing.source]) {
      merged.set(skill.name, skill);
    }
  }

  const sortedSkills = Array.from(merged.values()).sort((a, b) => {
    const pa = priority[a.source] ?? 99;
    const pb = priority[b.source] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  return {
    skills: sortedSkills,
    meta: {
      total: sortedSkills.length,
      sources_loaded: sourcesLoaded,
      unavailable_sources: unavailableSources,
    },
  };
}

/**
 * Strip leading `<!-- caipe-skill: ... -->` XML comments from skill content.
 * These annotations are used as source markers in hub repositories but are
 * not valid SKILL.md content — they appear before the YAML frontmatter and
 * prevent agents from recognising the `name:` and `description:` fields.
 */
function sanitizeSkillContent(content: string | null): string | null {
  if (!content) return content;
  return content.replace(/^(<!--[\s\S]*?-->\s*\n?)+/, "");
}

function sanitizeCatalogResponse(data: CatalogResponse): CatalogResponse {
  return {
    ...data,
    skills: data.skills.map((s) => ({
      ...s,
      content: sanitizeSkillContent(s.content),
    })),
  };
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  // Dual-auth: Bearer JWT or session cookie
  await getAuthFromBearerOrSession(req);

  const params = parseQueryParams(req);
  const authHeader = req.headers.get("Authorization");

  // Try backend proxy first (forwards all query params)
  const backendResult = await fetchFromBackend(params, authHeader);
  if (backendResult) {
    return NextResponse.json(sanitizeCatalogResponse(backendResult));
  }

  // Local aggregation fallback
  try {
    const catalog = await aggregateLocally(params.includeContent);
    const filtered = filterSkills(catalog.skills, params);
    const response = paginate(filtered, params, {
      sources_loaded: catalog.meta.sources_loaded,
      unavailable_sources: catalog.meta.unavailable_sources,
    });
    return NextResponse.json(response);
  } catch (err) {
    console.error("[Skills] Catalog unavailable:", err);
    return NextResponse.json(
      {
        error: "skills_unavailable",
        message:
          "Skills are temporarily unavailable. Please try again later.",
      } as unknown as CatalogResponse,
      { status: 503 },
    );
  }
});
