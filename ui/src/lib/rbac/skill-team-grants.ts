import { ObjectId } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import {
  writeOpenFgaTupleDiff,
  type OpenFgaReconcileResult,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import { reconcileShareableResource } from "@/lib/rbac/openfga-owned-resources";

interface TeamDoc {
  _id?: ObjectId | string;
  slug?: string;
  name?: string;
}

export interface GrantSkillsToTeamsInput {
  teamRefs: string[] | undefined | null;
  skillIds: string[] | undefined | null;
}

export interface GrantSkillsToTeamsResult {
  teamSlugs: string[];
  skillIds: string[];
  writesPlanned: number;
  writesApplied: number;
  enabled: boolean;
}

function normalizeList(values: string[] | undefined | null): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function teamDocKey(doc: TeamDoc): string | null {
  if (!doc._id) return null;
  if (doc._id instanceof ObjectId) return doc._id.toHexString();
  return String(doc._id);
}

async function resolveTeamSlugs(teamRefs: string[]): Promise<string[]> {
  const refs = normalizeList(teamRefs);
  if (refs.length === 0) return [];

  const objectIds = refs
    .filter((ref) => ObjectId.isValid(ref))
    .map((ref) => new ObjectId(ref));
  const teams = await getCollection<TeamDoc>("teams");
  const docs = await teams
    .find({
      $or: [
        ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
        { slug: { $in: refs } },
      ],
    })
    .project({ _id: 1, slug: 1, name: 1 })
    .toArray();

  const slugById = new Map<string, string>();
  const slugBySlug = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.slug) continue;
    const key = teamDocKey(doc);
    if (key) slugById.set(key, doc.slug);
    slugBySlug.set(doc.slug, doc.slug);
  }

  return refs.map((ref) => slugById.get(ref) ?? slugBySlug.get(ref) ?? ref);
}

export function buildSkillTeamGrantTuples(
  teamSlugs: string[],
  skillIds: string[],
): OpenFgaTupleKey[] {
  const tuples: OpenFgaTupleKey[] = [];
  for (const teamSlug of normalizeList(teamSlugs)) {
    for (const skillId of normalizeList(skillIds)) {
      tuples.push({
        user: `team:${teamSlug}#member`,
        relation: "user",
        object: `skill:${skillId}`,
      });
    }
  }
  return tuples;
}

export interface ReconcileSkillTeamSharesInput {
  skillId: string;
  /** Team refs (slug or ObjectId) the skill was shared with before this write. */
  previousTeamRefs?: string[] | null;
  /** Team refs the skill should be shared with after this write ([] = revoke all). */
  nextTeamRefs?: string[] | null;
}

/**
 * Reconcile a single skill's team-share grants through the shared shareable-
 * resource reconciler (spec 2026-06-03, the same tuple-core agents / RAG KBs /
 * MCP tools use). Unlike the write-only `grantSkillsToTeams` (kept for bulk
 * import / hub-refresh fan-out where there is no previous state), this diffs
 * `previousTeamRefs` against `nextTeamRefs` so un-sharing or re-sharing a skill
 * genuinely REVOKES the dropped `team:<slug>#member user skill:<id>` tuples
 * instead of orphaning them. Skills are user-owned (no owner team), so
 * `ownerTeamSlug` is null and only the shared-team set is reconciled with the
 * skill member relation `user`.
 */
export async function reconcileSkillTeamShares(
  input: ReconcileSkillTeamSharesInput,
): Promise<OpenFgaReconcileResult> {
  const [previousSharedTeamSlugs, nextSharedTeamSlugs] = await Promise.all([
    resolveTeamSlugs(normalizeList(input.previousTeamRefs)),
    resolveTeamSlugs(normalizeList(input.nextTeamRefs)),
  ]);
  return reconcileShareableResource({
    objectType: "skill",
    objectId: input.skillId,
    ownerTeamSlug: null,
    nextSharedTeamSlugs,
    previousSharedTeamSlugs,
    memberRelations: ["user"],
  });
}

export async function grantSkillsToTeams(
  input: GrantSkillsToTeamsInput,
): Promise<GrantSkillsToTeamsResult> {
  const skillIds = normalizeList(input.skillIds);
  const teamRefs = normalizeList(input.teamRefs);
  if (skillIds.length === 0 || teamRefs.length === 0) {
    return {
      teamSlugs: [],
      skillIds,
      writesPlanned: 0,
      writesApplied: 0,
      enabled: false,
    };
  }

  const teamSlugs = await resolveTeamSlugs(teamRefs);
  const writes = buildSkillTeamGrantTuples(teamSlugs, skillIds);
  const result = await writeOpenFgaTupleDiff({ writes, deletes: [] });
  return {
    teamSlugs,
    skillIds,
    writesPlanned: writes.length,
    writesApplied: result.writes,
    enabled: result.enabled,
  };
}
