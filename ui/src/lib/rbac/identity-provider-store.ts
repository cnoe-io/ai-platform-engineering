import type { IdentityProvider } from "@/types/identity-group-sync";

import { getRbacCollection } from "./mongo-collections";

export async function listIdentityProviders(): Promise<IdentityProvider[]> {
  const collection = await getRbacCollection<IdentityProvider & { id: string }>("identityProviders");
  return collection.find({}).sort({ display_name: 1 }).toArray();
}

export async function getIdentityProvider(providerId: string): Promise<IdentityProvider | null> {
  const collection = await getRbacCollection<IdentityProvider & { id: string }>("identityProviders");
  return collection.findOne({ id: providerId });
}

export async function upsertIdentityProvider(provider: IdentityProvider): Promise<void> {
  const collection = await getRbacCollection<IdentityProvider & { id: string }>("identityProviders");
  await collection.updateOne({ id: provider.id }, { $set: provider }, { upsert: true });
}
