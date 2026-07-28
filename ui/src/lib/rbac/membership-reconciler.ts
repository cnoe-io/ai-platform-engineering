import type { TeamMembershipSource } from "@/types/identity-group-sync";

import { loopYieldEvery, maybeYield } from "./event-loop-yield";
import type { OpenFgaTupleKey } from "./openfga";

export interface ReconcileTeamMembershipSourcesInput {
  existingSources: TeamMembershipSource[];
  desiredSources: TeamMembershipSource[];
  now: string;
  /**
   * External group ids actually observed in this sync. When provided, removals
   * are limited to existing memberships whose `external_group_id` is in this
   * set — so a FILTERED or otherwise partial fetch can add/update within the
   * groups it saw but never removes memberships for groups it didn't fetch.
   * When undefined, the fetch is treated as the complete directory snapshot and
   * any managed membership not in `desiredSources` is removed (full reconcile).
   */
  observedGroupIds?: Set<string>;
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

export async function reconcileTeamMembershipSources(
  input: ReconcileTeamMembershipSourcesInput
): Promise<ReconcileTeamMembershipSourcesResult> {
  // A full-directory reconcile walks hundreds of thousands of sources across
  // several passes with no awaited I/O; yield to the event loop periodically so
  // the pod's k8s liveness probe (served by this same process) still gets a
  // turn and the pod isn't SIGKILLed mid-reconcile.
  const yieldEvery = loopYieldEvery();
  let processed = 0;

  const existingActive: TeamMembershipSource[] = [];
  const existingBySource = new Map<string, TeamMembershipSource>();
  for (const source of input.existingSources) {
    await maybeYield(++processed, yieldEvery);
    if (source.status !== "active") continue;
    existingActive.push(source);
    existingBySource.set(sourceKey(source), source);
  }

  const desiredBySource = new Map<string, TeamMembershipSource>();
  const sourcesToAdd: TeamMembershipSource[] = [];
  for (const source of input.desiredSources) {
    await maybeYield(++processed, yieldEvery);
    const key = sourceKey(source);
    desiredBySource.set(key, source);
    if (!existingBySource.has(key)) sourcesToAdd.push(source);
  }

  const sourcesToRemove: TeamMembershipSource[] = [];
  for (const source of existingActive) {
    await maybeYield(++processed, yieldEvery);
    if (!source.managed || desiredBySource.has(sourceKey(source))) continue;
    // Scope guard: when the caller observed only a subset of groups (e.g. a
    // group filter), never remove memberships for groups outside that subset —
    // their absence from `desiredSources` just means we didn't look, not that
    // the membership is gone. Rows with no external_group_id (defensive) are
    // only removable in a full reconcile.
    if (input.observedGroupIds) {
      const inScope = source.external_group_id
        ? input.observedGroupIds.has(source.external_group_id)
        : false;
      if (!inScope) continue;
    }
    sourcesToRemove.push({ ...source, status: "removed" as const, removed_at: input.now });
  }

  // Tuple writes cover EVERY membership that should hold a live tuple after
  // this reconcile — the retained existing sources plus the newly-added ones —
  // not just the adds. This is what makes the sync self-healing: if a prior
  // run upserted the Mongo source row but its OpenFGA write never landed (e.g.
  // the pod was SIGKILLed mid-reconcile, so the catchable rollback never ran),
  // that row is "existing" on every later run and the old add-only diff would
  // never revisit it — its tuple would stay missing forever. By re-deriving
  // the full desired tuple set each run we converge to the correct state.
  //
  // Re-emitting an already-present tuple is safe and cheap: writeOpenFgaTuples()
  // reads each candidate back (see filterTupleDiff) and drops the ones already
  // stored, so a steady-state sync performs zero actual writes. uniqueTuples
  // collapses multiple sources that map to the same (user, relation, team).
  const removedKeys = new Set(sourcesToRemove.map((source) => sourceKey(source)));
  const survivingSources: TeamMembershipSource[] = [];
  for (const source of existingActive) {
    await maybeYield(++processed, yieldEvery);
    if (!removedKeys.has(sourceKey(source))) survivingSources.push(source);
  }
  const activeAfterReconcile = [...survivingSources, ...sourcesToAdd];
  const tupleWrites = uniqueTuples(
    activeAfterReconcile
      .filter((source) => source.status === "active" && source.user_subject)
      .map(memberTuple)
  );

  // A removed source's tuple must only be deleted when NO surviving (retained,
  // not-removed) active source still grants the same (user, relation, team)
  // access — otherwise we'd revoke a tuple another membership source still
  // backs. Precompute the set of access keys that survive the reconcile so this
  // is an O(1) lookup per removed source; the previous nested `.some()` scan was
  // O(n²) over existingActive × sourcesToRemove and, at full-directory scale
  // (hundreds of thousands of sources), pinned the event loop long enough to
  // trip the pod's liveness probe.
  const survivingAccessKeys = new Set(survivingSources.map((source) => accessKey(source)));
  const tupleDeletes = uniqueTuples(
    sourcesToRemove
      .filter((source) => source.user_subject)
      .filter((source) => !survivingAccessKeys.has(accessKey(source)))
      .map(memberTuple)
  );

  return { sourcesToAdd, sourcesToRemove, tupleWrites, tupleDeletes };
}
