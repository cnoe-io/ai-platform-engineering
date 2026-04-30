import { getCollection } from "@/lib/mongodb";
import { getUserTeamIds } from "@/lib/api-middleware";
import type { AgentSkill } from "@/types/agent-skill";

/**
 * Load a single agent_skills row if the user is allowed to see it
 * (system, owner, global, or team-shared).
 */
export async function getAgentSkillVisibleToUser(
  id: string,
  ownerEmail: string,
): Promise<AgentSkill | null> {
  const collection = await getCollection<AgentSkill>("agent_skills");
  const userTeamIds = await getUserTeamIds(ownerEmail);

  return collection.findOne({
    id,
    $or: [
      { is_system: true },
      { owner_id: ownerEmail },
      { visibility: "global" },
      ...(userTeamIds.length > 0
        ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
        : []),
    ],
  });
}

/** Same rules as updating a skill in MongoDB (owner for user skills; any auth user for built-in rows). */
export function userCanModifyAgentSkill(
  existing: AgentSkill,
  user: { email: string; role?: string },
): boolean {
  if (existing.is_system) {
    return true;
  }
  return existing.owner_id === user.email;
}
