import type { TeamMembershipSource } from "@/types/identity-group-sync";

import type { OpenFgaTupleKey } from "./openfga";

export interface ReconcileTeamMembershipSourcesInput {
  existingSources: TeamMembershipSource[];
  desiredSources: TeamMembershipSource[];
  now: string;
}

export interface ReconcileTeamMembershipSourcesResult {
  sourcesToAdd: TeamMembershipSource[];
  sourcesToRemove: TeamMembershipSource[];
  tupleWrites: OpenFgaTupleKey[];
  tupleDeletes: OpenFgaTupleKey[];
}

function sourceKey(source: TeamMembershipSource): string {
  return [
    source.team_slug,
    source.user_subject ?? source.user_email ?? "",
    source.relationship,
    source.source_type,
    source.provider_id ?? "",
    source.external_group_id ?? "",
    source.sync_rule_id ?? "",
  ].join("\n");
}

function accessKey(source: TeamMembershipSource): string {
  return [source.team_slug, source.user_subject ?? "", source.relationship].join("\n");
}

function memberTuple(source: TeamMembershipSource): OpenFgaTupleKey | null {
  if (!source.user_subject) return null;
  return {
    user: `user:${source.user_subject}`,
    relation: source.relationship,
    object: `team:${source.team_slug}`,
  };
}

function uniqueTuples(tuples: Array<OpenFgaTupleKey | null>): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    if (!tuple) continue;
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

export function reconcileTeamMembershipSources(
  input: ReconcileTeamMembershipSourcesInput
): ReconcileTeamMembershipSourcesResult {
  const existingActive = input.existingSources.filter((source) => source.status === "active");
  const existingBySource = new Map(existingActive.map((source) => [sourceKey(source), source]));
  const desiredBySource = new Map(input.desiredSources.map((source) => [sourceKey(source), source]));

  const sourcesToAdd = input.desiredSources.filter((source) => !existingBySource.has(sourceKey(source)));
  const sourcesToRemove = existingActive
    .filter((source) => source.managed && !desiredBySource.has(sourceKey(source)))
    .map((source) => ({ ...source, status: "removed" as const, removed_at: input.now }));

  const remainingAccess = new Set(
    existingActive
      .filter((source) => !sourcesToRemove.some((removed) => sourceKey(removed) === sourceKey(source)))
      .map(accessKey)
  );

  const tupleWrites = uniqueTuples(
    sourcesToAdd
      .filter((source) => source.status === "active" && source.user_subject)
      .filter((source) => !remainingAccess.has(accessKey(source)))
      .map(memberTuple)
  );

  const tupleDeletes = uniqueTuples(
    sourcesToRemove
      .filter((source) => source.user_subject)
      .filter((source) => {
        const otherActiveSource = existingActive.some(
          (existing) =>
            sourceKey(existing) !== sourceKey(source) &&
            accessKey(existing) === accessKey(source) &&
            !sourcesToRemove.some((removed) => sourceKey(removed) === sourceKey(existing))
        );
        return !otherActiveSource;
      })
      .map(memberTuple)
  );

  return { sourcesToAdd, sourcesToRemove, tupleWrites, tupleDeletes };
}
