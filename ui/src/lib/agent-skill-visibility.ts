import { getCollection } from "@/lib/mongodb";
import { canMutateBuiltinSkill } from "@/lib/builtin-skill-policy";
import type { AgentSkill } from "@/types/agent-skill";

/**
 * Load a single agent_skills row by id.
 *
 * Authorization is enforced by callers with concrete OpenFGA checks. Legacy
 * `visibility`, `owner_id`, and `shared_with_teams` fields are metadata only.
 */
export async function getAgentSkillVisibleToUser(
  id: string,
  _ownerEmail: string,
): Promise<AgentSkill | null> {
  const collection = await getCollection<AgentSkill>("agent_skills");
  return collection.findOne({ id });
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
