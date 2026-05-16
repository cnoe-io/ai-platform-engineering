import type { IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

import { writeOpenFgaTuples } from "./openfga";
import {
  markTeamMembershipSourceRemoved,
  upsertTeamMembershipSource,
} from "./team-membership-source-store";

export interface ApplyIdentityGroupSyncPlanInput {
  plan: IdentityGroupSyncDryRunResult;
  actor: string;
  now: string;
}

export interface ApplyIdentityGroupSyncPlanResult {
  membershipSourcesAdded: number;
  membershipSourcesRemoved: number;
  tupleWrites: number;
  tupleDeletes: number;
  openFgaEnabled: boolean;
}

export async function applyIdentityGroupSyncPlan(
  input: ApplyIdentityGroupSyncPlanInput
): Promise<ApplyIdentityGroupSyncPlanResult> {
  for (const source of input.plan.membership_sources_to_add) {
    await upsertTeamMembershipSource({
      ...source,
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
    membershipSourcesAdded: input.plan.membership_sources_to_add.length,
    membershipSourcesRemoved: input.plan.membership_sources_to_remove.length,
    tupleWrites: openFgaResult.writes,
    tupleDeletes: openFgaResult.deletes,
    openFgaEnabled: openFgaResult.enabled,
  };
}
