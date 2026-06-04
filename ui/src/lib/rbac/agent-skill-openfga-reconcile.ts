import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import {
  buildShareableResourceTupleDiff,
  type TeamResourceTupleDiff,
} from "@/lib/rbac/openfga-owned-resources";
import { organizationObjectId } from "@/lib/rbac/organization";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

export type SkillVisibility = "private" | "team" | "global";

export interface AgentSkillReconcileDoc {
  id?: string;
  owner_id?: string;
  visibility?: string;
  is_system?: boolean;
}

export interface AgentSkillOpenFgaReconcilePlan {
  writes: OpenFgaTupleKey[];
  deletes: OpenFgaTupleKey[];
  warnings: string[];
  counts: {
    skills_scanned: number;
    skills_reconciled: number;
    skills_skipped: number;
    owner_subjects_missing: number;
    tuples_writes_planned: number;
    tuples_deletes_planned: number;
  };
}

function isOpenFgaId(value: string): boolean {
  return OPENFGA_ID_PATTERN.test(value);
}

function uniqueTuples(tuples: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

function mergeDiffs(diffs: TeamResourceTupleDiff[]): TeamResourceTupleDiff {
  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];
  for (const diff of diffs) {
    writes.push(...diff.writes);
    deletes.push(...diff.deletes);
  }
  return { writes: uniqueTuples(writes), deletes: uniqueTuples(deletes) };
}

function normalizeVisibility(raw: string | undefined): SkillVisibility {
  if (raw === "team" || raw === "global") return raw;
  return "private";
}

/**
 * Team slugs that currently hold `team:<slug>#member user skill:<id>` grants.
 * Used as the FGA "before" set when Mongo says private/team so stale shares are
 * revoked even when Mongo no longer stores team-share metadata.
 */
export function teamSlugsFromSkillTuples(
  skillId: string,
  tuples: ReadonlyArray<OpenFgaTupleKey>,
): string[] {
  const object = `skill:${skillId}`;
  const slugs = new Set<string>();
  for (const tuple of tuples) {
    if (tuple.object !== object || tuple.relation !== "user") continue;
    const match = tuple.user.match(/^team:([^#]+)#member$/);
    if (!match || !isOpenFgaId(match[1])) continue;
    slugs.add(match[1]);
  }
  return [...slugs];
}

/** Whether OpenFGA currently grants org-wide `user` on this skill (global visibility). */
export function skillHasOrgWideUserGrant(
  skillId: string,
  tuples: ReadonlyArray<OpenFgaTupleKey>,
): boolean {
  const object = `skill:${skillId}`;
  const orgMember = `${organizationObjectId()}#member`;
  return tuples.some(
    (tuple) => tuple.object === object && tuple.user === orgMember && tuple.relation === "user",
  );
}

/**
 * Legacy/erroneous grants that must not remain on private skills.
 */
export function strayPrivateSkillTupleDeletes(
  skillId: string,
  visibility: SkillVisibility,
  tuples: ReadonlyArray<OpenFgaTupleKey>,
): OpenFgaTupleKey[] {
  if (visibility !== "private") return [];
  const object = `skill:${skillId}`;
  return tuples.filter(
    (tuple) =>
      tuple.object === object &&
      (tuple.user === "user:*" ||
        (tuple.user.startsWith("team:") && tuple.relation === "user") ||
        (tuple.user.startsWith("team:") && tuple.relation === "manager") ||
        (tuple.user === `${organizationObjectId()}#member` && tuple.relation === "user")),
  );
}

export function resolveTeamSlugsFromRefs(
  teamRefs: string[],
  slugByMongoId: Map<string, string>,
  knownSlugs: Set<string>,
): { slugs: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const ref of teamRefs) {
    const trimmed = String(ref || "").trim();
    if (!trimmed) continue;
    const resolved = slugByMongoId.get(trimmed) ?? (knownSlugs.has(trimmed) ? trimmed : null);
    if (!resolved || !isOpenFgaId(resolved)) {
      warnings.push(`Skipping unresolved team ref: ${trimmed}`);
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    slugs.push(resolved);
  }
  return { slugs, warnings };
}

export function buildAgentSkillShareTupleDiff(input: {
  skillId: string;
  visibility: SkillVisibility;
  sharedTeamRefs: string[];
  ownerSubject: string | null;
  existingTuples: ReadonlyArray<OpenFgaTupleKey>;
  slugByMongoId: Map<string, string>;
  knownSlugs: Set<string>;
}): { diff: TeamResourceTupleDiff; warnings: string[] } {
  const warnings: string[] = [];
  const previousSharedWithOrg = skillHasOrgWideUserGrant(input.skillId, input.existingTuples);

  const previousTeamSlugs = teamSlugsFromSkillTuples(input.skillId, input.existingTuples);
  let nextTeamSlugs: string[] = [];
  if (input.visibility === "team") {
    const resolved = resolveTeamSlugsFromRefs(
      input.sharedTeamRefs,
      input.slugByMongoId,
      input.knownSlugs,
    );
    warnings.push(...resolved.warnings);
    nextTeamSlugs =
      resolved.slugs.length > 0 ? resolved.slugs : previousTeamSlugs;
  }

  const shareDiff = buildShareableResourceTupleDiff({
    objectType: "skill",
    objectId: input.skillId,
    creatorSubject: input.ownerSubject,
    ownerSubject: input.ownerSubject,
    ownerTeamSlug: null,
    nextSharedTeamSlugs: nextTeamSlugs,
    previousSharedTeamSlugs: previousTeamSlugs,
    memberRelations: ["user"],
    sharedWithOrg: input.visibility === "global",
    previousSharedWithOrg,
  });

  const strayDeletes = strayPrivateSkillTupleDeletes(
    input.skillId,
    input.visibility,
    input.existingTuples,
  );
  const deletes = uniqueTuples([...shareDiff.deletes, ...strayDeletes]);

  return {
    diff: { writes: shareDiff.writes, deletes },
    warnings,
  };
}

export function groupSkillTuplesById(
  tuples: ReadonlyArray<OpenFgaTupleKey>,
): Map<string, OpenFgaTupleKey[]> {
  const bySkill = new Map<string, OpenFgaTupleKey[]>();
  for (const tuple of tuples) {
    if (!tuple.object.startsWith("skill:")) continue;
    const skillId = tuple.object.slice("skill:".length);
    if (!skillId) continue;
    const bucket = bySkill.get(skillId) ?? [];
    bucket.push(tuple);
    bySkill.set(skillId, bucket);
  }
  return bySkill;
}

export function deriveAgentSkillOpenFgaReconcilePlan(input: {
  skills: AgentSkillReconcileDoc[];
  tuplesBySkillId: Map<string, OpenFgaTupleKey[]>;
  subjectsByOwnerEmail: Map<string, string>;
  slugByMongoId: Map<string, string>;
  knownSlugs: Set<string>;
}): AgentSkillOpenFgaReconcilePlan {
  const warnings: string[] = [];
  const perSkillDiffs: TeamResourceTupleDiff[] = [];
  let skillsScanned = 0;
  let skillsReconciled = 0;
  let skillsSkipped = 0;
  let ownerSubjectsMissing = 0;

  for (const skill of input.skills) {
    skillsScanned += 1;
    const skillId = typeof skill.id === "string" ? skill.id.trim() : "";
    if (!skillId || !isOpenFgaId(skillId)) {
      skillsSkipped += 1;
      warnings.push(`Skipping skill with invalid id: ${String(skill.id)}`);
      continue;
    }

    const visibility = normalizeVisibility(skill.visibility);
    const ownerEmail = typeof skill.owner_id === "string" ? skill.owner_id.trim().toLowerCase() : "";
    const ownerSubject = ownerEmail ? input.subjectsByOwnerEmail.get(ownerEmail) ?? null : null;
    if (!ownerSubject && !skill.is_system) {
      ownerSubjectsMissing += 1;
      warnings.push(
        `Skill ${skillId}: no Keycloak sub for owner ${ownerEmail || "(missing)"}; owner/creator tuples will be omitted`,
      );
    }

    const existingTuples = input.tuplesBySkillId.get(skillId) ?? [];
    const { diff, warnings: skillWarnings } = buildAgentSkillShareTupleDiff({
      skillId,
      visibility,
      sharedTeamRefs: [],
      ownerSubject,
      existingTuples,
      slugByMongoId: input.slugByMongoId,
      knownSlugs: input.knownSlugs,
    });
    warnings.push(...skillWarnings);
    perSkillDiffs.push(diff);
    skillsReconciled += 1;
  }

  const merged = mergeDiffs(perSkillDiffs);
  return {
    writes: merged.writes,
    deletes: merged.deletes,
    warnings,
    counts: {
      skills_scanned: skillsScanned,
      skills_reconciled: skillsReconciled,
      skills_skipped: skillsSkipped,
      owner_subjects_missing: ownerSubjectsMissing,
      tuples_writes_planned: merged.writes.length,
      tuples_deletes_planned: merged.deletes.length,
    },
  };
}
