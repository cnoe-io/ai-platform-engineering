/** Check a project's wiki pages for template drift (#508). Synchronous, no SSE. */

import type { ProjectSnapshot } from "@/lib/tome/agent-proxy";

export type PageDriftStatus = "missing" | "unbound" | "version_behind" | "current";

export interface PageDrift {
  path: string;
  status: PageDriftStatus;
  title?: string | null;
  template_scope?: string | null;
  template_path?: string | null;
  seeded_version?: number | null;
  live_version?: number | null;
  drifted?: boolean | null;
  reason?: string | null;
}

export async function checkTemplateDrift(
  snapshot: ProjectSnapshot,
  pages: Record<string, string>,
  model?: string,
): Promise<PageDrift[]> {
  if (!process.env.TOME_AGENT_URL) {
    throw new Error("TOME_AGENT_URL not configured");
  }
  const response = await fetch(
    `${process.env.TOME_AGENT_URL.replace(/\/$/, "")}/template-drift`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, pages, model }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Template drift check failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  const data = (await response.json()) as { pages: PageDrift[] };
  return data.pages;
}
