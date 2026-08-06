/**
 * Greenfield wiki seeding.
 *
 * CAIPE `project.description` feeds the charter intro. Stable pages stay
 * human-edited; dynamic pages seed as empty placeholders for the ingest
 * agent to fill later.
 *
 * Server-only.
 */

import {
  EMPTY_PAGE_PLACEHOLDER,
  MEMORY_SEED,
  pageWithFrontmatter,
} from "./schema";
import { getPageStore } from "./page-store";
import { getPageTemplate } from "./page-templates-store";

/** Select only founding templates whose live page does not already exist. */
export function missingPageTemplates(
  templates: Record<string, string>,
  existing: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(templates).filter(([path]) => !(path in existing)),
  );
}

/**
 * Build the initial `{path: markdown}` for a fresh project from the live
 * top-level template config (admin-editable; falls back to the hardcoded
 * defaults). Stable/hidden pages seed with their configured body scaffold;
 * dynamic/report pages seed as empty placeholders the ingest agent fills.
 *
 * @param description CAIPE `project.description`, prepended to the charter.
 */
export async function buildGreenfieldPages(
  description: string,
): Promise<Record<string, string>> {
  const template = await getPageTemplate("top-level");
  const pages: Record<string, string> = {};

  for (const spec of template.pages) {
    if (spec.enabled === false) continue; // templating off for this page
    // Every page seeds with its configured body (stable scaffolds, the memory
    // page, or a dynamic/report guidance comment); pages without one seed as an
    // empty placeholder the ingest agent fills.
    const bodyText = spec.body ?? (spec.kind === "hidden" ? MEMORY_SEED : EMPTY_PAGE_PLACEHOLDER);
    let body = pageWithFrontmatter(spec, bodyText);
    // Seed the charter's intro from the project description (decision A).
    if (spec.path === "charter.md" && description.trim()) {
      body = injectCharterIntro(body, description.trim());
    }
    pages[spec.path] = body;
  }
  return pages;
}

/**
 * Insert the project description as a lead paragraph directly under the
 * charter's first `## What we're building` heading, replacing the italic
 * prompt line beneath it.
 */
export function injectCharterIntro(charterMd: string, description: string): string {
  const heading = "## What we're building";
  const idx = charterMd.indexOf(heading);
  if (idx === -1) return charterMd;
  const afterHeading = idx + heading.length;
  const rest = charterMd.slice(afterHeading);
  // Drop a leading blank line + the placeholder italic prompt line, if present.
  const cleaned = rest.replace(/^\n+_[^\n]*_\n/, "\n");
  return `${charterMd.slice(0, afterHeading)}\n${description}\n${cleaned}`;
}

/**
 * Seed a project's wiki if it has no pages yet. Returns the number of pages
 * written (0 if the project was already seeded). Idempotent.
 */
export async function seedGreenfieldIfEmpty(
  projectId: string,
  description: string,
  author = "tome-seed",
): Promise<number> {
  const store = await getPageStore();
  const existing = await store.listPages(projectId);
  if (Object.keys(existing).length > 0) return 0;
  const pages = await buildGreenfieldPages(description);
  await store.writePages(projectId, pages, {
    message: "seed: greenfield wiki",
    author,
  });
  return Object.keys(pages).length;
}
