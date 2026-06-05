import { getCollection } from "@/lib/mongodb";
import { canMutateBuiltinSkill } from "@/lib/builtin-skill-policy";
import { readSkillSharedTeamSlugsFromOpenFga } from "@/lib/rbac/skill-team-grants";
import type { AgentSkill } from "@/types/agent-skill";

/**
 * Load a single agent_skills row by id.
 *
 * Authorization is enforced by callers with concrete OpenFGA checks. Mongo
 * stores `visibility` and `owner_id` as metadata; team shares are OpenFGA-only
 * and exposed on API responses via {@link hydrateAgentSkillTeamShares}.
 */
export async function getAgentSkillVisibleToUser(
  id: string,
  _ownerEmail: string,
): Promise<AgentSkill | null> {
  const collection = await getCollection<AgentSkill>("agent_skills");
  return collection.findOne({ id });
}

/**
 * Attach `shared_with_teams` on API responses from OpenFGA (not Mongo).
 * Values are team slugs (UI accepts slug or Mongo team `_id` refs).
 */
export async function hydrateAgentSkillTeamShares(skill: AgentSkill): Promise<AgentSkill> {
  if (skill.visibility !== "team") {
    return { ...skill, shared_with_teams: undefined };
  }
  const slugs = await readSkillSharedTeamSlugsFromOpenFga(skill.id);
  return {
    ...skill,
    shared_with_teams: slugs.length > 0 ? slugs : undefined,
  };
}

export async function hydrateAgentSkillTeamSharesList(
  skills: AgentSkill[],
): Promise<AgentSkill[]> {
  return Promise.all(skills.map((skill) => hydrateAgentSkillTeamShares(skill)));
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
 *   2. Concrete resource authorization is enforced by callers through OpenFGA
 *      (`skill#write`, `skill#manage`, etc.). Non-built-in rows reach this
 *      helper only after that check has allowed the operation.
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
  return true;
}
