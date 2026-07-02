import { readOpenFgaTuples, writeOpenFgaTuples, type OpenFgaTupleKey } from './openfga';

/**
 * Cascade for Layer 1 revocation. When a team loses
 * autonomous eligibility, every `team:<slug>#member -> automator -> agent:*`
 * grant must be deleted so `can_schedule` (= automator and can_use) drops to
 * false at the next run. Returns the number of tuples deleted.
 *
 * Integration note: the read uses a type-only object filter (`object: 'agent:'`).
 * Confirm this against the live OpenFGA read API before release — the unit tests
 * mock the read.
 */
export async function revokeTeamAutomatorGrants(teamSlug: string): Promise<number> {
  const filter: OpenFgaTupleKey = { user: `team:${teamSlug}#member`, relation: 'automator', object: 'agent:' };
  const result = await readOpenFgaTuples({ tuple: filter });
  const deletes = result.tuples
    .map((t) => t.key)
    .filter((k) => k.user === filter.user && k.relation === 'automator' && k.object.startsWith('agent:'));
  if (deletes.length === 0) return 0;
  await writeOpenFgaTuples({ writes: [], deletes });
  return deletes.length;
}
