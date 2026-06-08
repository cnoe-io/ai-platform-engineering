import type {
  ExternalGroup,
  IdentityGroupSyncDryRunResult,
  IdentityGroupSyncRule,
  IdentityGroupSyncSafetyWarning,
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
const LARGE_REMOVAL_WARNING_THRESHOLD = 10;

export interface PlanIdentityGroupSyncInput {
  groups: ExternalGroupWithMembers[];
  rules: IdentityGroupSyncRule[];
  existingTeams: ExistingTeam[];
  existingMembershipSources: TeamMembershipSource[];
  now: string;
  actor: string;
  allowTeamCreation?: boolean;
}

export function sourceTypeForProvider(providerId: string): TeamMembershipSource["source_type"] {
  if (providerId.startsWith("okta")) return "okta";
  if (providerId.startsWith("ad")) return "active_directory";
  return "oidc_claim";
}

function sourceKey(source: TeamMembershipSource): string {
  return [
    source.team_slug,
    source.user_subject ?? source.user_email ?? "",
    source.relationship,
    source.source_type,
    source.provider_id ?? "",
    source.external_group_id ?? "",
    source.sync_rule_id ?? "",
  ].join("\n");
}

function buildSafetyWarnings(input: {
  existingSources: TeamMembershipSource[];
  desiredSources: TeamMembershipSource[];
  sourcesToRemove: TeamMembershipSource[];
}): IdentityGroupSyncSafetyWarning[] {
  const warnings: IdentityGroupSyncSafetyWarning[] = [];
  if (input.sourcesToRemove.length === 0) return warnings;

  if (input.sourcesToRemove.length > LARGE_REMOVAL_WARNING_THRESHOLD) {
    warnings.push({
      code: "large_membership_removal",
      severity: "blocker",
      message: `${input.sourcesToRemove.length} managed memberships would be removed by this sync.`,
      requires_acknowledgement: true,
      affected_count: input.sourcesToRemove.length,
    });
  }

  for (const source of input.sourcesToRemove.filter((source) => source.relationship === "admin")) {
    warnings.push({
      code: "admin_membership_removal",
      severity: "blocker",
      message: `Admin membership for ${source.user_email ?? source.user_subject ?? "unknown user"} on team ${source.team_slug} would be removed.`,
      requires_acknowledgement: true,
      team_slug: source.team_slug,
      user_identifier: source.user_email ?? source.user_subject,
    });
  }

  const removedKeys = new Set(input.sourcesToRemove.map(sourceKey));
  const activeAfter = [
    ...input.existingSources.filter((source) => source.status === "active" && !removedKeys.has(sourceKey(source))),
    ...input.desiredSources.filter((source) => source.status === "active"),
  ];
  for (const source of input.sourcesToRemove) {
    const hasRemainingManagedMember = activeAfter.some(
      (remaining) => remaining.managed && remaining.team_slug === source.team_slug
    );
    if (hasRemainingManagedMember) continue;
    if (warnings.some((warning) => warning.code === "orphaned_team_membership" && warning.team_slug === source.team_slug)) {
      continue;
    }
    warnings.push({
      code: "orphaned_team_membership",
      severity: "warning",
      message: `Team ${source.team_slug} would have no active managed identity-sync memberships in this sync scope; review resource grants for abandoned access.`,
      requires_acknowledgement: true,
      team_slug: source.team_slug,
    });
  }

  return warnings;
}

export function planIdentityGroupSync(input: PlanIdentityGroupSyncInput): IdentityGroupSyncDryRunResult {
  const allowTeamCreation = input.allowTeamCreation ?? true;
  const existingTeamBySlug = new Map(input.existingTeams.map((team) => [team.slug, team]));
  const ruleResult = evaluateIdentityGroupRules({
    groups: input.groups,
    rules: input.rules,
    existingTeamSlugs: input.existingTeams.map((team) => team.slug),
  });

  const teamsToCreateBySlug = new Map<string, { slug: string; name: string; source_group_id: string }>();
  for (const match of ruleResult.matches
    .filter((match) => allowTeamCreation && !existingTeamBySlug.has(match.teamSlug) && match.rule.auto_create_team)
  ) {
    if (teamsToCreateBySlug.has(match.teamSlug)) continue;
    teamsToCreateBySlug.set(match.teamSlug, {
      slug: match.teamSlug,
      name: match.teamName,
      source_group_id: match.group.external_group_id,
    });
  }
  const teams_to_create = Array.from(teamsToCreateBySlug.values());

  const skipped_users: IdentityGroupSyncDryRunResult["skipped_users"] = [];
  const desiredSources: TeamMembershipSource[] = [];

  for (const match of ruleResult.matches) {
    const team = existingTeamBySlug.get(match.teamSlug);
    if (!team && !allowTeamCreation) {
      continue;
    }
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
  const safety_warnings = buildSafetyWarnings({
    existingSources: input.existingMembershipSources,
    desiredSources,
    sourcesToRemove: reconciliation.sourcesToRemove,
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
    safety_warnings,
  };
}
