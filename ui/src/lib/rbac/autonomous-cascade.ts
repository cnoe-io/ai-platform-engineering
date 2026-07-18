import { readOpenFgaTuples, writeOpenFgaTuples, type OpenFgaTupleKey } from './openfga';

export interface RevokeTeamAutomatorGrantsResult {
  count: number;
  /** Agent ids that lost their automator tuple, so callers can cascade-pause each agent's autonomous tasks. */
  agentIds: string[];
}

/**
 * Cascade for Layer 1 revocation. When a team loses autonomous eligibility,
 * every `team:<slug>#member -> automator -> agent:*` grant must be deleted so
 * `can_schedule` (= automator and can_use) drops to false at the next run.
 *
 * OpenFGA's /read requires an OBJECT TYPE in the tuple_key filter -- a
 * user+relation-only filter 400s with "object type field is required" (same
 * constraint already hit and fixed for agent-tuple reads in
 * openfga-agent-tools / slack-channel-diagnostics / webex-space-openfga /
 * the Slack routes route). Automator is only ever written against
 * `agent:*` objects, so scope the read to that type with an empty id
 * (`agent:`) and keep the local filter below as defense in depth.
 */
export async function revokeTeamAutomatorGrants(
  teamSlug: string,
): Promise<RevokeTeamAutomatorGrantsResult> {
  const filter: Partial<OpenFgaTupleKey> = {
    user: `team:${teamSlug}#member`,
    relation: 'automator',
    object: 'agent:',
  };
  const deletes: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await readOpenFgaTuples({ tuple: filter, continuationToken, pageSize: 100 });
    deletes.push(
      ...result.tuples
        .map((t) => t.key)
        .filter(
          (k) =>
            k.user === filter.user &&
            k.relation === 'automator' &&
            k.object.startsWith('agent:'),
        ),
    );
    continuationToken = result.continuationToken;
  } while (continuationToken);

  if (deletes.length === 0) return { count: 0, agentIds: [] };
  await writeOpenFgaTuples({ writes: [], deletes });
  return {
    count: deletes.length,
    agentIds: deletes.map((d) => d.object.slice('agent:'.length)),
  };
}
