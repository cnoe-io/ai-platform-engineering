import { ObjectId } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import { writeOpenFgaTupleDiff, type OpenFgaTupleKey } from "@/lib/rbac/openfga";

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
