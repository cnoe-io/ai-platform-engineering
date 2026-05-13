import type { TeamMembershipSource } from "@/types/identity-group-sync";

import { getRbacCollection } from "./mongo-collections";

function membershipSourceFilter(source: TeamMembershipSource): Record<string, unknown> {
  return {
    team_slug: source.team_slug,
    user_subject: source.user_subject,
    relationship: source.relationship,
    source_type: source.source_type,
    provider_id: source.provider_id,
    external_group_id: source.external_group_id,
    sync_rule_id: source.sync_rule_id,
  };
}

export async function listTeamMembershipSources(teamId: string): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_id: string }>(
    "teamMembershipSources"
  );
  return collection.find({ team_id: teamId }).sort({ created_at: -1 }).toArray();
}

export async function listActiveTeamMembershipSourcesBySlug(
  teamSlug: string
): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_slug: string }>(
    "teamMembershipSources"
  );
  return collection.find({ team_slug: teamSlug, status: "active" }).sort({ created_at: -1 }).toArray();
}

export async function listActiveTeamMembershipSourcesForProvider(
  providerId: string
): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { provider_id?: string }>(
    "teamMembershipSources"
  );
  return collection
    .find({ provider_id: providerId, status: "active", managed: true })
    .sort({ created_at: -1 })
    .toArray();
}

export async function listActiveTeamMembershipSourcesForTeamUser(input: {
  teamId?: string;
  teamSlug?: string;
  userSubject?: string;
  userEmail?: string;
  relationship?: TeamMembershipSource["relationship"];
}): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
  const identityFilters: Record<string, string>[] = [];
  if (input.userSubject) identityFilters.push({ user_subject: input.userSubject });
  if (input.userEmail) identityFilters.push({ user_email: input.userEmail });
  if (identityFilters.length === 0) return [];

  const filter: Record<string, unknown> = {
    status: "active",
    $or: identityFilters,
  };
  if (input.teamId) filter.team_id = input.teamId;
  if (input.teamSlug) filter.team_slug = input.teamSlug;
  if (input.relationship) filter.relationship = input.relationship;

  return collection.find(filter).sort({ created_at: -1 }).toArray();
}

export async function listActiveTeamMembershipSourcesForUser(input: {
  providerId: string;
  sourceType: TeamMembershipSource["source_type"];
  userSubject?: string;
  userEmail?: string;
}): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { provider_id?: string }>(
    "teamMembershipSources"
  );
  const identityFilters: Record<string, string>[] = [];
  if (input.userSubject) identityFilters.push({ user_subject: input.userSubject });
  if (input.userEmail) identityFilters.push({ user_email: input.userEmail });
  if (identityFilters.length === 0) return [];

  return collection
    .find({
      provider_id: input.providerId,
      source_type: input.sourceType,
      status: "active",
      managed: true,
      $or: identityFilters,
    })
    .sort({ created_at: -1 })
    .toArray();
}

export async function upsertTeamMembershipSource(source: TeamMembershipSource): Promise<void> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_slug: string }>(
    "teamMembershipSources"
  );
  await collection.updateOne(membershipSourceFilter(source), { $set: source }, { upsert: true });
}

export async function markTeamMembershipSourceRemoved(
  source: TeamMembershipSource,
  removedBy: string,
  removedAt: string
): Promise<void> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_slug: string }>(
    "teamMembershipSources"
  );
  await collection.updateOne(membershipSourceFilter(source), {
    $set: {
      status: "removed",
      removed_by: removedBy,
      removed_at: removedAt,
    },
  });
}
