import { getCollection } from "@/lib/mongodb";
import {
  deriveAgentSkillOpenFgaReconcilePlan,
  groupSkillTuplesById,
  type AgentSkillReconcileDoc,
} from "@/lib/rbac/agent-skill-openfga-reconcile";
import { readOpenFgaTuples, writeOpenFgaTupleDiff } from "@/lib/rbac/openfga";
import type { MigrationApplyResult, MigrationPlanResult } from "@/lib/rbac/migrations/types";

export const AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID = "agent_skill_openfga_reconcile_v1";
const RELEASE_058 = "0.5.8";
export const AGENT_SKILL_OPENFGA_RECONCILE_CONFIRMATION = "MIGRATE agent_skills TO v2";

interface UserIdentityDoc {
  email?: string;
  keycloak_sub?: string;
  metadata?: { keycloak_sub?: string };
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

function subjectForUser(user: UserIdentityDoc): string | null {
  return user.keycloak_sub?.trim() || user.metadata?.keycloak_sub?.trim() || null;
}

function buildEmailSubjectIndex(users: UserIdentityDoc[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const user of users) {
    const email = normalizeEmail(user.email);
    const subject = subjectForUser(user);
    if (email && subject) index.set(email, subject);
  }
  return index;
}

function mongoId(doc: Record<string, unknown>): string | null {
  const idValue = doc._id;
  if (typeof idValue === "string" && idValue.trim()) return idValue.trim();
  if (idValue && typeof (idValue as { toString?: () => string }).toString === "function") {
    return (idValue as { toString: () => string }).toString();
  }
  return null;
}

export async function loadAgentSkillOpenFgaReconcileInputs(): Promise<{
  skills: AgentSkillReconcileDoc[];
  tuplesBySkillId: Map<string, import("@/lib/rbac/openfga").OpenFgaTupleKey[]>;
  subjectsByOwnerEmail: Map<string, string>;
  slugByMongoId: Map<string, string>;
  knownSlugs: Set<string>;
}> {
  const [skillsCollection, usersCollection, teamsCollection] = await Promise.all([
    getCollection<AgentSkillReconcileDoc>("agent_skills"),
    getCollection<UserIdentityDoc>("users"),
    getCollection("teams"),
  ]);

  const [skills, users, teamDocs] = await Promise.all([
    skillsCollection.find({}).toArray(),
    usersCollection.find({}).toArray(),
    teamsCollection.find({}, { projection: { _id: 1, slug: 1 } } as never).toArray(),
  ]);

  const slugByMongoId = new Map<string, string>();
  const knownSlugs = new Set<string>();
  for (const doc of teamDocs as Array<Record<string, unknown>>) {
    const slug = typeof doc.slug === "string" ? doc.slug.trim() : "";
    if (!slug) continue;
    knownSlugs.add(slug);
    const idString = mongoId(doc);
    if (idString) slugByMongoId.set(idString, slug);
  }

  const skillTuples: import("@/lib/rbac/openfga").OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({ continuationToken, pageSize: 100 });
    for (const entry of page.tuples) {
      if (entry.key.object.startsWith("skill:")) {
        skillTuples.push(entry.key);
      }
    }
    continuationToken = page.continuationToken;
  } while (continuationToken);

  return {
    skills,
    tuplesBySkillId: groupSkillTuplesById(skillTuples),
    subjectsByOwnerEmail: buildEmailSubjectIndex(users),
    slugByMongoId,
    knownSlugs,
  };
}

export async function planAgentSkillOpenFgaReconcileMigration(): Promise<
  MigrationPlanResult & {
    tuples: import("@/lib/rbac/openfga").OpenFgaTupleKey[];
    tuple_deletes: import("@/lib/rbac/openfga").OpenFgaTupleKey[];
  }
> {
  const inputs = await loadAgentSkillOpenFgaReconcileInputs();
  const plan = deriveAgentSkillOpenFgaReconcilePlan(inputs);

  const sampleDiffs = plan.writes.slice(0, 5).map((tuple, index) => ({
    collection: "openfga_tuples",
    id: `${AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID}:write:${index}`,
    before: {},
    after: { ...tuple },
  }));
  for (const [index, tuple] of plan.deletes.slice(0, 5).entries()) {
    sampleDiffs.push({
      collection: "openfga_tuples",
      id: `${AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID}:delete:${index}`,
      before: { ...tuple } as Record<string, unknown>,
      after: {} as Record<string, unknown>,
    });
  }

  return {
    migration_id: AGENT_SKILL_OPENFGA_RECONCILE_MIGRATION_ID,
    release: RELEASE_058,
    schema_area: "agent_skills",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: plan.counts,
    warnings: plan.warnings,
    sample_diffs: sampleDiffs,
    tuple_writes_planned: plan.counts.tuples_writes_planned,
    confirmation: AGENT_SKILL_OPENFGA_RECONCILE_CONFIRMATION,
    tuples: plan.writes,
    tuple_deletes: plan.deletes,
  };
}

export async function applyAgentSkillOpenFgaReconcileMigration(input: {
  plan: MigrationPlanResult & {
    tuples?: import("@/lib/rbac/openfga").OpenFgaTupleKey[];
    tuple_deletes?: import("@/lib/rbac/openfga").OpenFgaTupleKey[];
  };
  actor: string;
  now: string;
}): Promise<MigrationApplyResult> {
  const writes = input.plan.tuples ?? [];
  const deletes = input.plan.tuple_deletes ?? [];
  const result = await writeOpenFgaTupleDiff({ writes, deletes });

  return {
    ...input.plan,
    applied_counts: {
      tuple_writes_applied: result.writes,
      tuple_deletes_applied: result.deletes,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };
}
