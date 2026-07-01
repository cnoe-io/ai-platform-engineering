// Canonical resolver for `tome://` references (#65). One place that turns a
// reference into a concrete target so the UI hover/click, the MCP tool, and the
// agent all resolve the same way.
//
// Relative by default, explicit when crossing projects:
//   tome://<path>             resolves in the current project
//   tome://@<project>/<path>  resolves in the named project (RBAC permitting)
// No first-segment guessing and no global term namespace: a cross-project ref
// always names its project, so resolution is deterministic.

import { getCollection } from "@/lib/mongodb";
import { getPageStore } from "./page-store";
import { parseFrontmatter } from "./schema";
import { parseTomeHref } from "./tome-links";
import type { ProjectDocument } from "@/types/projects";

export interface GlossaryResolution {
  kind: "glossary";
  found: boolean;
  term?: string;
  expansion?: string;
  definition?: string;
  scope?: string;
  project_slug?: string;
  source_path?: string;
  /** True when resolved from a project other than the caller's. */
  cross_project?: boolean;
}

export interface PageResolution {
  kind: "page";
  found: boolean;
  path: string;
  title?: string;
  project_slug?: string;
  cross_project?: boolean;
}

export type Resolution =
  | GlossaryResolution
  | PageResolution
  | { kind: "unknown"; found: false };

const DEF_MAX = 600;

async function readPageSafe(projectId: string, path: string): Promise<string> {
  try {
    const store = await getPageStore();
    return await store.readPage(projectId, path);
  } catch {
    return "";
  }
}

async function projectBySlug(slug: string): Promise<{ id: string; slug: string } | null> {
  const projects = await getCollection<ProjectDocument>("projects");
  const p = await projects.findOne({ slug });
  return p ? { id: String(p._id), slug: p.slug } : null;
}

function glossaryFromMarkdown(md: string): {
  term: string;
  expansion?: string;
  definition: string;
  scope: string;
} {
  const [fm, body] = parseFrontmatter(md);
  const expansion =
    typeof fm.expansion === "string" && fm.expansion.trim() ? fm.expansion.trim() : undefined;
  return {
    term: String(fm.term ?? fm.title ?? ""),
    expansion,
    definition: body.replace(/^#.*$/m, "").trim().slice(0, DEF_MAX),
    scope: String(fm.scope ?? "project").toLowerCase(),
  };
}

async function resolveGlossaryIn(
  projectId: string,
  projectSlug: string,
  termSlug: string,
  crossProject: boolean,
): Promise<GlossaryResolution> {
  const path = `glossary/${termSlug}.md`;
  const md = await readPageSafe(projectId, path);
  if (!md) return { kind: "glossary", found: false };
  return {
    kind: "glossary",
    found: true,
    ...glossaryFromMarkdown(md),
    project_slug: projectSlug,
    source_path: path,
    cross_project: crossProject,
  };
}

async function resolvePageIn(
  projectId: string,
  projectSlug: string,
  path: string,
  crossProject: boolean,
): Promise<PageResolution> {
  const md = await readPageSafe(projectId, path);
  if (!md) return { kind: "page", found: false, path };
  const [fm] = parseFrontmatter(md);
  return {
    kind: "page",
    found: true,
    path,
    title: String(fm.title ?? ""),
    project_slug: projectSlug,
    cross_project: crossProject,
  };
}

/**
 * Resolve any `tome://` reference relative to the caller's (current) project.
 * A `@<project>` ref resolves in that named project instead.
 */
export async function resolveRef(
  currentProjectId: string,
  currentSlug: string,
  ref: string,
): Promise<Resolution> {
  const target = parseTomeHref(ref);
  if (!target) return { kind: "unknown", found: false };

  // Determine which project to resolve in.
  let projectId = currentProjectId;
  let projectSlug = currentSlug;
  let crossProject = false;
  if (target.project && target.project !== currentSlug) {
    const named = await projectBySlug(target.project);
    if (!named) {
      // Named project doesn't exist / not visible.
      return target.glossaryTerm
        ? { kind: "glossary", found: false }
        : { kind: "page", found: false, path: target.path };
    }
    projectId = named.id;
    projectSlug = named.slug;
    crossProject = true;
  }

  if (target.glossaryTerm) {
    return resolveGlossaryIn(projectId, projectSlug, target.glossaryTerm, crossProject);
  }
  return resolvePageIn(projectId, projectSlug, target.path, crossProject);
}
