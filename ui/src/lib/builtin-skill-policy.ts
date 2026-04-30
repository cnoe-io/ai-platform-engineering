/**
 * Built-in skill mutation policy.
 *
 * Locks user-driven edit / delete on `agent_skills` rows that have
 * ``is_system: true`` (i.e. seeded built-in templates). This is a
 * separate concern from the **scan** gate — flagged skills are
 * already blocked from runtime by ``scan_gate.py`` regardless of
 * this lock. This lock just prevents an admin from accidentally
 * tampering with what the platform shipped.
 *
 * Default: locked. Set ``ALLOW_BUILTIN_SKILL_MUTATION=true`` to let
 * authenticated admins edit / delete built-in rows again.
 *
 * Routes seeded by ``/api/skills/seed`` and
 * ``/api/skills/templates/import`` bypass this helper because they
 * call ``insertOne`` directly on the collection — they're internal
 * server flows, not user mutations, so they keep working under the
 * lock. The same goes for the scan persistence routes
 * (``/api/skills/configs/[id]/scan`` + ``/api/skills/scan-all``)
 * which only write ``scan_*`` metadata fields, not user content.
 */

import type { AgentSkill } from "@/types/agent-skill";

/**
 * Read the env flag. Default = `false` (locked).
 *
 * Tested via ``process.env.ALLOW_BUILTIN_SKILL_MUTATION`` directly so
 * unit tests can monkey-patch the value without rebuilding the
 * config bridge.
 */
export function isBuiltinMutationAllowed(): boolean {
  return process.env.ALLOW_BUILTIN_SKILL_MUTATION === "true";
}

/**
 * Decide whether the given user is allowed to mutate (edit / delete /
 * file-write) the given existing skill.
 *
 * Caller is responsible for the broader visibility / ownership check
 * — this helper only adds the built-in lock layer. Returns ``false``
 * when the row is a built-in (`is_system: true`) AND mutation is
 * locked. All other cases return ``true`` (the caller still needs
 * to do their own ownership check; this is a pre-condition, not a
 * complete authorisation).
 */
export function canMutateBuiltinSkill(existing: Pick<AgentSkill, "is_system">): boolean {
  if (!existing.is_system) return true;
  return isBuiltinMutationAllowed();
}

/**
 * Human-readable reason returned to the API client when the lock
 * blocks a mutation. Kept here so the toast message in the UI and
 * the 403 body stay in sync.
 */
export const BUILTIN_LOCKED_MESSAGE =
  "Built-in skills are read-only. Use Clone to create an editable copy, or set ALLOW_BUILTIN_SKILL_MUTATION=true to allow direct edits.";

export const BUILTIN_LOCKED_ERROR_CODE = "builtin_skill_locked";
