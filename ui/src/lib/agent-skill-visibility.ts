import { getCollection } from "@/lib/mongodb";
import { getUserTeamIds } from "@/lib/api-middleware";
import { canMutateBuiltinSkill } from "@/lib/builtin-skill-policy";
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

/**
 * Authorisation for skill mutation (PUT / PATCH / DELETE / file-write).
 *
 * Layered policy:
 *
 *   1. Built-in lock (``ALLOW_BUILTIN_SKILL_MUTATION``, default off):
 *      ``is_system: true`` rows are read-only for all users unless
 *      the operator has explicitly opted in via the env flag. Admins
 *      escape via the ``POST /api/skills/configs/[id]/clone`` route
 *      that produces an editable user-owned copy.
 *
 *   2. Ownership: a user can mutate a non-built-in row when they
 *      own it. (Visibility-based read access is handled by
 *      ``getAgentSkillVisibleToUser`` separately.)
 *
 * Note: the ``user`` argument is kept for forward-compatibility with
 * an admin override (e.g. ``user.role === "admin"`` could in future
 * bypass the built-in lock). Today no role auto-bypasses — the env
 * flag is the only escape.
 */
export function userCanModifyAgentSkill(
  existing: AgentSkill,
  user: { email: string; role?: string },
): boolean {
  if (existing.is_system) {
    return canMutateBuiltinSkill(existing);
  }
  return existing.owner_id === user.email;
}
