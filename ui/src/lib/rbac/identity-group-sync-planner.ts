import type {
  ExternalGroup,
  IdentityGroupSyncDryRunResult,
  IdentityGroupSyncRule,
  TeamMembershipSource,
} from "@/types/identity-group-sync";

import { evaluateIdentityGroupRules } from "./identity-group-rule-matcher";
import { reconcileTeamMembershipSources } from "./membership-reconciler";

interface ExistingTeam {
  id: string;
  slug: string;
  name: string;
}

interface ExternalGroupMember {
  subject?: string;
  email: string;
  display_name?: string;
  active: boolean;
}

type ExternalGroupWithMembers = ExternalGroup & { members?: ExternalGroupMember[] };

export interface PlanIdentityGroupSyncInput {
  groups: ExternalGroupWithMembers[];
  rules: IdentityGroupSyncRule[];
  existingTeams: ExistingTeam[];
  existingMembershipSources: TeamMembershipSource[];
  now: string;
  actor: string;
}

function sourceTypeForProvider(providerId: string): TeamMembershipSource["source_type"] {
  if (providerId.startsWith("okta")) return "okta";
  if (providerId.startsWith("ad")) return "active_directory";
  return "oidc_claim";
}

export function planIdentityGroupSync(input: PlanIdentityGroupSyncInput): IdentityGroupSyncDryRunResult {
  const existingTeamBySlug = new Map(input.existingTeams.map((team) => [team.slug, team]));
  const ruleResult = evaluateIdentityGroupRules({
    groups: input.groups,
    rules: input.rules,
    existingTeamSlugs: input.existingTeams.map((team) => team.slug),
  });

  const teams_to_create = ruleResult.matches
    .filter((match) => !existingTeamBySlug.has(match.teamSlug) && match.rule.auto_create_team)
    .map((match) => ({
      slug: match.teamSlug,
      name: match.teamName,
      source_group_id: match.group.external_group_id,
    }));

  const skipped_users: IdentityGroupSyncDryRunResult["skipped_users"] = [];
  const desiredSources: TeamMembershipSource[] = [];

  for (const match of ruleResult.matches) {
    const team = existingTeamBySlug.get(match.teamSlug);
    const teamId = team?.id ?? match.teamSlug;
    for (const member of (match.group as ExternalGroupWithMembers).members ?? []) {
      if (!member.active) {
        skipped_users.push({
          source_group_id: match.group.external_group_id,
          user_identifier: member.email,
          reason: "inactive_user",
        });
        continue;
      }
      if (!member.subject) {
        skipped_users.push({
          source_group_id: match.group.external_group_id,
          user_identifier: member.email,
          reason: "missing_subject",
        });
        continue;
      }
      desiredSources.push({
        team_id: teamId,
        team_slug: match.teamSlug,
        user_subject: member.subject,
        user_email: member.email,
        relationship: match.relationship,
        source_type: sourceTypeForProvider(match.group.provider_id),
        provider_id: match.group.provider_id,
        external_group_id: match.group.external_group_id,
        sync_rule_id: match.rule.id,
        managed: true,
        status: "active",
        first_seen_at: input.now,
        last_seen_at: input.now,
        created_by: input.actor,
        created_at: input.now,
      });
    }
  }

  const reconciliation = reconcileTeamMembershipSources({
    existingSources: input.existingMembershipSources,
    desiredSources,
    now: input.now,
  });

  return {
    matched_groups: ruleResult.matches.map((match) => match.group),
    ignored_groups: ruleResult.ignored.map((ignored) => ignored.group),
    teams_to_create,
    membership_sources_to_add: reconciliation.sourcesToAdd,
    membership_sources_to_remove: reconciliation.sourcesToRemove,
    tuple_writes: reconciliation.tupleWrites,
    tuple_deletes: reconciliation.tupleDeletes,
    skipped_users,
    conflicts: ruleResult.conflicts.map((conflict) => ({
      source_group_id: conflict.group.external_group_id,
      reason: conflict.reason,
    })),
  };
}
