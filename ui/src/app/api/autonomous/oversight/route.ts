import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { loadTeamMembersForSlugs } from "@/lib/rbac/team-membership-store";
import { groupTasksByTeam } from "@/lib/autonomous/oversight-grouping";
import type { AutonomousTask } from "@/components/autonomous/types";

export const dynamic = "force-dynamic";

interface TeamDoc { name?: string; slug?: string }

function autonomousBaseUrl(): string {
  return (
    process.env.AUTONOMOUS_AGENTS_URL ||
    process.env.NEXT_PUBLIC_AUTONOMOUS_AGENTS_URL ||
    "http://localhost:8002"
  ).replace(/\/$/, "");
}

/** GET /api/autonomous/oversight — admin-only team→person→task grouping. */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  // 1) All teams (slug + name).
  const teamsCol = await getCollection<TeamDoc>("teams");
  const teamDocs = await teamsCol.find({}).project({ slug: 1, name: 1 }).toArray();
  const teams = teamDocs
    .filter((t): t is Required<Pick<TeamDoc, "slug" | "name">> => !!t.slug && !!t.name)
    .map((t) => ({ slug: t.slug, name: t.name }));

  // 2) All memberships for those teams — one bulk query.
  const membersBySlug = await loadTeamMembersForSlugs(teams.map((t) => t.slug));

  // 3) All tasks — admin list from the autonomous service (is-admin header → list_all).
  const res = await fetch(`${autonomousBaseUrl()}/api/v1/tasks`, {
    headers: {
      "Content-Type": "application/json",
      "X-Authenticated-User-Email": user.email,
      "X-Authenticated-User-Is-Admin": "true",
    },
  });
  // Surface a downstream failure as an error rather than silently returning an
  // empty task list — otherwise a dead autonomous service renders as a fully
  // healthy "0 tasks everywhere" grid, indistinguishable from genuinely empty.
  if (!res.ok) {
    throw new ApiError(
      `Autonomous-agents service returned ${res.status} while listing tasks`,
      502,
    );
  }
  const tasks: AutonomousTask[] = await res.json();

  return successResponse(groupTasksByTeam(teams, membersBySlug, tasks));
});
