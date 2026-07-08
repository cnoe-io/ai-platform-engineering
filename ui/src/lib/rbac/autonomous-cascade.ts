import { readOpenFgaTuples, writeOpenFgaTuples, type OpenFgaTupleKey } from './openfga';

/**
 * Cascade for Layer 1 revocation. When a team loses autonomous eligibility,
 * every `team:<slug>#member -> automator -> agent:*` grant must be deleted so
 * `can_schedule` (= automator and can_use) drops to false at the next run.
 *
 * OpenFGA read filters match exact object ids, not object type prefixes. Read
 * all automator tuples for the team and filter `agent:*` objects locally.
 */
export async function revokeTeamAutomatorGrants(teamSlug: string): Promise<number> {
  const filter: Partial<OpenFgaTupleKey> = {
    user: `team:${teamSlug}#member`,
    relation: 'automator',
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

  if (deletes.length === 0) return 0;
  await writeOpenFgaTuples({ writes: [], deletes });
  return deletes.length;
}
