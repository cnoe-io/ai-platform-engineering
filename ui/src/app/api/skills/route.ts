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
 *   Otherwise, aggregates locally from disk templates and MongoDB `agent_skills` (same data as GET /api/skills/configs).
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

export interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  source: "default" | "agent_skills" | "hub";
  source_id: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  /**
   * Sibling files (paths relative to the skill folder). Populated only
   * when the caller asks for `include_content=true`. Lets API gateway
   * consumers (Claude Code, Cursor, install.sh) materialise the full
   * skill folder verbatim instead of only SKILL.md.
   */
  ancillary_files?: Record<string, string>;
  /** Operator-facing summary of what was captured / skipped. */
  ancillary_summary?: {
    total_files: number;
    total_bytes: number;
    skipped_binary: number;
    skipped_too_large: number;
    truncated_at_count_cap: boolean;
    truncated_at_size_cap: boolean;
  };
  /**
   * Cached scan state, hydrated from the appropriate collection per source:
   *   - `agent_skills` doc directly (already projected here)
   *   - `builtin_skill_scans` keyed by template id (joined below)
   *   - hub crawler returns these on its own
   * Absent when the skill has never been scanned.
   *
   * ``"admin_overridden"`` is set by the per-skill scan-override admin
   * route when an operator explicitly green-lights a previously
   * ``"flagged"`` skill with a written reason. Treated as runnable
   * here AND on the Python loader side (``scan_gate.is_status_blocked``)
   * — the admin override is the runtime source of truth, not just a
   * UI badge. ``ADMIN_SCAN_OVERRIDE_ENABLED=false`` collapses
   * ``admin_overridden`` back to ``flagged`` (blocked) on both sides
   * for regulated environments.
   */
  scan_status?: "passed" | "flagged" | "unscanned" | "admin_overridden";
  scan_summary?: string;
  scan_updated_at?: string;
  /**
   * Operator-facing audit metadata for an ``"admin_overridden"`` skill.
   * Populated by the override route, returned to the UI so the
   * scan-status report dialog can show who/when/why and offer
   * "Remove override" to admins. ``prior_scan_status`` is the value
   * the override replaced — usually ``"flagged"`` — so we can render
   * "Override active. Scanner had returned: flagged" without keeping
   * a stale copy of the verdict in two fields. Absent unless
   * ``scan_status === "admin_overridden"``.
   */
  scan_override?: {
    set_by: string;
    set_at: string;
    reason: string;
    prior_scan_status: "flagged";
    prior_scan_summary?: string;
  };
  /**
   * Whether the skill is runnable / installable / ingestible. Set to
   * `false` whenever the security scanner has flagged the skill — the
   * UI surfaces this as a disabled card with a "Disabled — flagged"
   * badge so admins can still see and re-scan it. Defaults to `true`
   * when omitted.
   *
   * The supervisor + dynamic agents enforce the same rule
   * independently (Python ``scan_gate`` module) so a stale UI badge
   * cannot make a flagged skill executable. ``"admin_overridden"``
   * skills are runnable on both sides (UI here, Python there) when
   * the admin-override feature is enabled.
   */
  runnable?: boolean;
  /** Operator-visible reason for ``runnable=false``. */
  blocked_reason?: "scan_flagged";
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
 * persisted agent skills from MongoDB (`agent_skills`) into a single catalog.
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

    // Best-effort lookup of cached scan results so the gallery shield
    // shows fresh badges immediately after a sweep / per-template scan.
    // If Mongo is down we just leave scan_status undefined → "Unscanned".
    // Built-in skills can never be admin-overridden today (templates
    // live on disk and have no per-skill admin UI), but the type
    // includes ``"admin_overridden"`` for symmetry with the
    // CatalogSkill union — if an operator hand-edits the
    // builtin_skill_scans collection, the projection must round-trip
    // it instead of crashing on the union narrowing. The override
    // metadata sub-doc is intentionally not projected here for the
    // same reason: there is no admin UI to populate it for built-ins.
    type BuiltinScanDoc = {
      id: string;
      scan_status: "passed" | "flagged" | "unscanned" | "admin_overridden";
      scan_summary?: string;
      scan_updated_at?: Date;
      scan_override?: CatalogSkill["scan_override"];
    };
    let builtinScans = new Map<string, BuiltinScanDoc>();
    try {
      const { getCollection: getColForScans, isMongoDBConfigured: scansMongoOk } =
        await import("@/lib/mongodb");
      if (scansMongoOk) {
        const scansCol = await getColForScans<BuiltinScanDoc>(
          "builtin_skill_scans",
        );
        const scanDocs = await scansCol
          .find({})
          .project<BuiltinScanDoc>({ _id: 0 })
          .toArray();
        builtinScans = new Map(scanDocs.map((d) => [d.id, d]));
      }
    } catch (err) {
      console.warn(
        "[Skills] Failed to load builtin_skill_scans cache (badges will show as Unscanned):",
        err,
      );
    }

    for (const t of templates) {
      const meta: Record<string, unknown> = {
        category: t.category,
        icon: t.icon,
        tags: t.tags,
      };
      if (t.input_variables && t.input_variables.length > 0) {
        meta.input_variables = t.input_variables;
      }
      const scan = builtinScans.get(t.id);
      skills.push({
        id: t.id,
        name: t.name,
        description: t.description,
        source: "default",
        source_id: null,
        content: includeContent ? t.content : null,
        metadata: meta,
        ...(scan?.scan_status ? { scan_status: scan.scan_status } : {}),
        ...(scan?.scan_summary !== undefined
          ? { scan_summary: scan.scan_summary }
          : {}),
        ...(scan?.scan_updated_at
          ? {
              scan_updated_at:
                scan.scan_updated_at instanceof Date
                  ? scan.scan_updated_at.toISOString()
                  : String(scan.scan_updated_at),
            }
          : {}),
        ...(scan?.scan_override ? { scan_override: scan.scan_override } : {}),
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
              ancillary_files: 1,
              scan_status: 1,
              scan_summary: 1,
              scan_updated_at: 1,
              // Admin override metadata (set_by / set_at / reason /
              // prior_scan_status / prior_scan_summary). Pulled in
              // every catalog response so the report-status dialog
              // can render the audit trail without an extra round
              // trip. Absent on docs without an override.
              scan_override: 1,
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
          ancillary_files:
            includeContent && doc.ancillary_files
              ? (doc.ancillary_files as Record<string, string>)
              : undefined,
          ...(doc.scan_status
            ? {
                scan_status: doc.scan_status as
                  | "passed"
                  | "flagged"
                  | "unscanned"
                  | "admin_overridden",
              }
            : {}),
          ...(doc.scan_summary !== undefined
            ? { scan_summary: String(doc.scan_summary) }
            : {}),
          ...(doc.scan_updated_at
            ? {
                scan_updated_at:
                  doc.scan_updated_at instanceof Date
                    ? doc.scan_updated_at.toISOString()
                    : String(doc.scan_updated_at),
              }
            : {}),
          // Pass-through override audit metadata. We don't validate
          // the shape here — the override route is the only writer
          // and the type narrowing in the dialog component handles
          // missing fields defensively (a hand-edited doc with a
          // partial override should still render).
          ...(doc.scan_override
            ? {
                scan_override: doc.scan_override as CatalogSkill["scan_override"],
              }
            : {}),
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
          for (const s of hubSkills) {
            // Hub crawler always returns content + ancillary_files in the
            // CatalogSkill shape; strip them when the caller didn't ask
            // for content so the listing payload stays small.
            skills.push({
              ...s,
              content: includeContent ? s.content : null,
              ancillary_files: includeContent ? s.ancillary_files : undefined,
            });
          }
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

/**
 * Whether the admin scan-override feature is enabled. Defaults to true
 * to match the Python ``scan_gate.is_admin_override_enabled``: regulated
 * deployments flip ``ADMIN_SCAN_OVERRIDE_ENABLED=false`` to remove the
 * escape hatch entirely. We mirror the Python parsing here (any non-
 * explicit-false string keeps it on) so a typo can't silently disable
 * the feature on only one of the two sides.
 *
 * Exported for tests; not meant for use outside this module.
 */
export function isAdminOverrideEnabled(): boolean {
  const raw = (process.env.ADMIN_SCAN_OVERRIDE_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}

/**
 * Stamp ``runnable`` / ``blocked_reason`` on every skill based on its
 * cached scan status. Default is ``runnable: true``.
 *
 * Flagging rules (mirror ``scan_gate.is_status_blocked`` in Python):
 *   - ``flagged``  ⇒ always not-runnable.
 *   - ``admin_overridden`` ⇒ runnable when ``ADMIN_SCAN_OVERRIDE_ENABLED``
 *     is on (default); otherwise treated like ``flagged`` so a single
 *     env flip on the Node tier matches the Python tier and removes
 *     the escape hatch in lockstep.
 *   - everything else (including ``unscanned``) ⇒ runnable here. The
 *     Python loader applies stricter ``SKILL_SCANNER_GATE=strict`` rules
 *     for the runtime; this UI gate is intentionally permissive so the
 *     gallery still shows skills the runtime would refuse, with the
 *     scan-status badge explaining why.
 *
 * This is the single UI-facing enforcement point so the gallery,
 * runner, and downstream consumers (Skills API gateway, install.sh)
 * all agree without each having to re-derive the rule. The Python
 * supervisor and dynamic agents enforce the same policy via
 * ``scan_gate.py``; this stamp is for UI affordances + defense in
 * depth against a backend that hasn't yet been updated.
 */
export function applyRunnableGate(skill: CatalogSkill): CatalogSkill {
  if (skill.scan_status === "flagged") {
    return { ...skill, runnable: false, blocked_reason: "scan_flagged" };
  }
  if (
    skill.scan_status === "admin_overridden" &&
    !isAdminOverrideEnabled()
  ) {
    // Override feature disabled ⇒ collapse back to flagged. We keep
    // the scan_status field as-is so the UI can still render the
    // override metadata (set_by/reason) and explain *why* the skill
    // is now blocked despite the override.
    return { ...skill, runnable: false, blocked_reason: "scan_flagged" };
  }
  return { ...skill, runnable: skill.runnable ?? true };
}

function sanitizeCatalogResponse(data: CatalogResponse): CatalogResponse {
  return {
    ...data,
    skills: data.skills.map((s) =>
      applyRunnableGate({
        ...s,
        content: sanitizeSkillContent(s.content),
      }),
    ),
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
    return NextResponse.json(sanitizeCatalogResponse(response));
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
