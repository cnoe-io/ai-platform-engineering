import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-middleware";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { getCollection } from "@/lib/mongodb";

interface StepEntry {
  type?: string;
  agent_id?: string;
}

interface CheckBody {
  steps: StepEntry[];
  visibility: "private" | "team" | "global";
  shared_with_teams?: string[];
}

export interface AgentAccessGap {
  agentId: string;
  agentName: string;
  teamsWithoutAccess: string[];
}

export interface CheckAgentAccessResponse {
  gaps: AgentAccessGap[];
}

// Deduplicate agent IDs from workflow steps.
function agentIdsFromSteps(steps: StepEntry[]): string[] {
  const seen = new Set<string>();
  for (const step of steps) {
    if (step?.type === "step" && typeof step.agent_id === "string" && step.agent_id.trim()) {
      seen.add(step.agent_id.trim());
    }
  }
  return [...seen];
}

async function resolveAgentNames(agentIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const col = await getCollection<{ _id: string; name?: string }>("dynamic_agents");
    const docs = await col
      .find({ _id: { $in: agentIds } }, { projection: { name: 1 } })
      .toArray();
    for (const doc of docs) {
      names.set(String(doc._id), doc.name ?? String(doc._id));
    }
  } catch {
    // Non-fatal — fall back to using the ID as the name.
  }
  for (const id of agentIds) {
    if (!names.has(id)) names.set(id, id);
  }
  return names;
}

// A global agent's `user:*` grant covers every team's users. Otherwise, check
// whether team:{slug}#member has an explicit `user` relation on the agent.
async function teamHasAgentAccess(teamSlug: string, agentId: string): Promise<boolean> {
  try {
    const globalResult = await checkOpenFgaTuple({
      user: "user:*",
      relation: "user",
      object: `agent:${agentId}`,
    });
    if (globalResult.allowed) return true;
  } catch {
    // A failed global check does not rule out an explicit team grant.
  }

  try {
    const result = await checkOpenFgaTuple({
      user: `team:${teamSlug}#member`,
      relation: "user",
      object: `agent:${agentId}`,
    });
    return result.allowed;
  } catch {
    // Treat check errors conservatively — surface the gap.
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withAuth(request, async () => {
    let body: CheckBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { steps = [], visibility, shared_with_teams = [] } = body;

    // Only team-scoped workflows need per-team agent access checks.
    // Global workflows are accessible to all users — surface a gap only when
    // the agent itself is not globally accessible (user:* → user → agent:id).
    const teamsToCheck =
      visibility === "team"
        ? shared_with_teams.filter((s) => typeof s === "string" && s.trim())
        : [];

    if (teamsToCheck.length === 0 && visibility !== "global") {
      return NextResponse.json<CheckAgentAccessResponse>({ gaps: [] });
    }

    const agentIds = agentIdsFromSteps(steps);
    if (agentIds.length === 0) {
      return NextResponse.json<CheckAgentAccessResponse>({ gaps: [] });
    }

    const agentNames = await resolveAgentNames(agentIds);
    const gaps: AgentAccessGap[] = [];

    if (visibility === "global") {
      // For global workflows check whether user:* has access to each agent.
      for (const agentId of agentIds) {
        try {
          const result = await checkOpenFgaTuple({
            user: "user:*",
            relation: "user",
            object: `agent:${agentId}`,
          });
          if (!result.allowed) {
            gaps.push({
              agentId,
              agentName: agentNames.get(agentId) ?? agentId,
              teamsWithoutAccess: ["(all users)"],
            });
          }
        } catch {
          gaps.push({
            agentId,
            agentName: agentNames.get(agentId) ?? agentId,
            teamsWithoutAccess: ["(all users)"],
          });
        }
      }
    } else {
      // team visibility — check each (agent, team) pair in parallel.
      await Promise.all(
        agentIds.map(async (agentId) => {
          const missing = (
            await Promise.all(
              teamsToCheck.map(async (slug) => ({
                slug,
                ok: await teamHasAgentAccess(slug, agentId),
              })),
            )
          )
            .filter((r) => !r.ok)
            .map((r) => r.slug);

          if (missing.length > 0) {
            gaps.push({
              agentId,
              agentName: agentNames.get(agentId) ?? agentId,
              teamsWithoutAccess: missing,
            });
          }
        }),
      );
    }

    return NextResponse.json<CheckAgentAccessResponse>({ gaps });
  });
}
