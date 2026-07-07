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
  DEFAULT_PAGES,
  EMPTY_PAGE_PLACEHOLDER,
  MEMORY_SEED,
  pageWithFrontmatter,
  stableSeedPage,
} from "./schema";
import { getPageStore } from "./page-store";

/**
 * Build the initial `{path: markdown}` for a fresh project. Pure — no I/O — so
 * it's easy to test and the ingest worker can reuse it.
 *
 * @param description CAIPE `project.description`, prepended to the charter.
 */
export function buildGreenfieldPages(
  description: string,
): Record<string, string> {
  const pages: Record<string, string> = {};

  for (const spec of DEFAULT_PAGES) {
    if (spec.kind === "stable") {
      let body = stableSeedPage(spec.path) ?? pageWithFrontmatter(spec, "");
      // Seed the charter's intro from the project description (decision A).
      if (spec.path === "charter.md" && description.trim()) {
        body = injectCharterIntro(body, description.trim());
      }
      pages[spec.path] = body;
    } else if (spec.kind === "hidden") {
      pages[spec.path] = pageWithFrontmatter(spec, MEMORY_SEED);
    } else {
      // dynamic + report: empty placeholder until the agent fills them.
      pages[spec.path] = pageWithFrontmatter(spec, EMPTY_PAGE_PLACEHOLDER);
    }
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
  const pages = buildGreenfieldPages(description);
  await store.writePages(projectId, pages, {
    message: "seed: greenfield wiki",
    author,
  });
  return Object.keys(pages).length;
}
