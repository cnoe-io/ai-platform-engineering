import type { IdentityGroupSyncRule } from "@/types/identity-group-sync";

import { getRbacCollection } from "./mongo-collections";

/**
 * Provider id used by the seeded catch-all rule so a single rule applies to
 * every IdP. `listIdentityGroupSyncRules(providerId)` returns rules scoped to
 * that provider PLUS any wildcard rules, so login (e.g. `okta`) and the
 * background Okta sync (`okta`) both match the same 1:1 bootstrap rule without
 * per-provider seeding.
 */
export const WILDCARD_PROVIDER_ID = "*";

export async function listIdentityGroupSyncRules(
  providerId?: string
): Promise<IdentityGroupSyncRule[]> {
  const collection = await getRbacCollection<IdentityGroupSyncRule & { id: string }>(
    "identityGroupSyncRules"
  );
  // When scoped to a provider, also include wildcard ("*") rules so the
  // shared catch-all applies regardless of which IdP produced the groups.
  const filter = providerId
    ? { provider_id: { $in: [providerId, WILDCARD_PROVIDER_ID] } }
    : {};
  return collection.find(filter).sort({ priority: 1, name: 1 }).toArray();
}

export async function getIdentityGroupSyncRule(ruleId: string): Promise<IdentityGroupSyncRule | null> {
  const collection = await getRbacCollection<IdentityGroupSyncRule & { id: string }>(
    "identityGroupSyncRules"
  );
  return collection.findOne({ id: ruleId });
}

export async function upsertIdentityGroupSyncRule(rule: IdentityGroupSyncRule): Promise<void> {
  const collection = await getRbacCollection<IdentityGroupSyncRule & { id: string }>(
    "identityGroupSyncRules"
  );
  await collection.updateOne({ id: rule.id }, { $set: rule }, { upsert: true });
}
