import type { ExternalGroup } from "@/types/identity-group-sync";

import type { ExternalGroupTeamLinkDocument } from "./mongo-collections";
import { getRbacCollection } from "./mongo-collections";

export async function upsertExternalGroup(group: ExternalGroup): Promise<void> {
  const collection = await getRbacCollection<ExternalGroup & { provider_id: string }>("externalGroups");
  await collection.updateOne(
    { provider_id: group.provider_id, external_group_id: group.external_group_id },
    { $set: group },
    { upsert: true }
  );
}

export async function listExternalGroups(providerId: string): Promise<ExternalGroup[]> {
  const collection = await getRbacCollection<ExternalGroup & { provider_id: string }>("externalGroups");
  return collection.find({ provider_id: providerId }).sort({ display_name: 1 }).toArray();
}

export async function upsertExternalGroupTeamLink(
  link: ExternalGroupTeamLinkDocument
): Promise<void> {
  const collection = await getRbacCollection<ExternalGroupTeamLinkDocument>("externalGroupTeamLinks");
  await collection.updateOne(
    {
      provider_id: link.provider_id,
      external_group_id: link.external_group_id,
      sync_rule_id: link.sync_rule_id,
      relationship_role: link.relationship_role,
    },
    { $set: link },
    { upsert: true }
  );
}

export async function listExternalGroupTeamLinks(teamId: string): Promise<ExternalGroupTeamLinkDocument[]> {
  const collection = await getRbacCollection<ExternalGroupTeamLinkDocument>("externalGroupTeamLinks");
  return collection.find({ team_id: teamId }).sort({ last_seen_at: -1 }).toArray();
}
