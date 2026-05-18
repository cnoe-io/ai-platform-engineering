import type { IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";
import { getCollection } from "@/lib/mongodb";

import { writeOpenFgaTuples } from "./openfga";
import {
  markTeamMembershipSourceRemoved,
  upsertTeamMembershipSource,
} from "./team-membership-source-store";

interface IdentitySyncTeam {
  id?: string;
  _id?: unknown;
  slug: string;
  name: string;
}

export interface ApplyIdentityGroupSyncPlanInput {
  plan: IdentityGroupSyncDryRunResult;
  actor: string;
  now: string;
}

export interface ApplyIdentityGroupSyncPlanResult {
  teamsCreated: number;
  membershipSourcesAdded: number;
  membershipSourcesRemoved: number;
  tupleWrites: number;
  tupleDeletes: number;
  openFgaEnabled: boolean;
}

async function ensureIdentitySyncTeams(input: {
  plan: IdentityGroupSyncDryRunResult;
  actor: string;
  now: string;
}): Promise<{ teamsCreated: number; teamIdsBySlug: Map<string, string> }> {
  const teamIdsBySlug = new Map<string, string>();
  if (input.plan.teams_to_create.length === 0) {
    return { teamsCreated: 0, teamIdsBySlug };
  }

  const teams = await getCollection<IdentitySyncTeam & Record<string, unknown>>("teams");
  const slugs = Array.from(new Set(input.plan.teams_to_create.map((team) => team.slug)));
  const existing = await teams.find({ slug: { $in: slugs } }).project({ _id: 1, id: 1, slug: 1, name: 1 }).toArray();
  for (const team of existing) {
    teamIdsBySlug.set(team.slug, team.id ?? String(team._id ?? team.slug));
  }

  let teamsCreated = 0;
  for (const team of input.plan.teams_to_create) {
    if (teamIdsBySlug.has(team.slug)) continue;
    const result = await teams.insertOne({
      name: team.name,
      slug: team.slug,
      description: `Created from identity group ${team.source_group_id}`,
      source: "identity_group_sync",
      status: "active",
      source_group_id: team.source_group_id,
      created_by: input.actor,
      updated_by: input.actor,
      created_at: new Date(input.now),
      updated_at: new Date(input.now),
      members: [],
    });
    teamIdsBySlug.set(team.slug, String(result.insertedId));
    teamsCreated += 1;
  }

  return { teamsCreated, teamIdsBySlug };
}

export async function applyIdentityGroupSyncPlan(
  input: ApplyIdentityGroupSyncPlanInput
): Promise<ApplyIdentityGroupSyncPlanResult> {
  const { teamsCreated, teamIdsBySlug } = await ensureIdentitySyncTeams(input);
  for (const source of input.plan.membership_sources_to_add) {
    await upsertTeamMembershipSource({
      ...source,
      team_id: teamIdsBySlug.get(source.team_slug) ?? source.team_id,
      last_applied_at: input.now,
    });
  }
  for (const source of input.plan.membership_sources_to_remove) {
    await markTeamMembershipSourceRemoved(source, input.actor, input.now);
  }

  const openFgaResult = await writeOpenFgaTuples({
    writes: input.plan.tuple_writes,
    deletes: input.plan.tuple_deletes,
  });

  return {
    teamsCreated,
    membershipSourcesAdded: input.plan.membership_sources_to_add.length,
    membershipSourcesRemoved: input.plan.membership_sources_to_remove.length,
    tupleWrites: openFgaResult.writes,
    tupleDeletes: openFgaResult.deletes,
    openFgaEnabled: openFgaResult.enabled,
  };
}
