import type { IdentityGroupSyncRule } from "@/types/identity-group-sync";

import { getRbacCollection } from "./mongo-collections";

export async function listIdentityGroupSyncRules(
  providerId?: string
): Promise<IdentityGroupSyncRule[]> {
  const collection = await getRbacCollection<IdentityGroupSyncRule & { id: string }>(
    "identityGroupSyncRules"
  );
  const filter = providerId ? { provider_id: providerId } : {};
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
