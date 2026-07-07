// Source-activity feed status. Powers the "Source activity feed" panel
// in project Settings. Reports which principal (data steward, or owner as
// fallback) the feed runs as, whether that principal actually has GitHub
// connected (so the silent no-op becomes a visible state), the repos, and the
// per-project on/off. Read-only + viewer-visible (transparency); changing the
// steward/toggle goes through PATCH /api/projects/[slug] (owner/admin gated).

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getCollection } from "@/lib/mongodb";
import { resolveCredentialsForSub } from "@/lib/tome/agent-proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function subForEmail(email: string | undefined): Promise<string> {
  const e = email?.trim().toLowerCase();
  if (!e) return "";
  const users = await getCollection<{
    email?: string;
    keycloak_sub?: string;
    metadata?: { keycloak_sub?: string };
  }>("users");
  const user = await users.findOne({ email: e });
  return user?.keycloak_sub || user?.metadata?.keycloak_sub || "";
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { project } = await loadTomeProject(request, slug);

  const steward = project.data_steward ?? "";
  const assigned = Boolean(steward);
  const repos = project.sources?.repos ?? [];

  // Resolve the steward's GitHub connection so the panel can show connected vs
  // not-connected (the whole point of surfacing this). Best-effort: any failure
  // resolving credentials just reports "not connected". Only meaningful when a
  // steward is actually assigned — there is no owner fallback.
  let githubConnected = false;
  if (assigned) {
    try {
      const sub = await subForEmail(steward);
      if (sub) {
        const creds = await resolveCredentialsForSub(sub);
        githubConnected = Boolean(creds["github"]?.access_token);
      }
    } catch {
      githubConnected = false;
    }
  }

  return successResponse({
    enabled: project.sources_feed_enabled !== false,
    assigned,
    steward,
    // The owner, offered as a one-click default when no steward is assigned.
    owner: project.owner_id ?? "",
    github_connected: githubConnected,
    repos,
  });
});
