import { test, expect } from "./identity-group-rebac-fixture";

const DRY_RUN_PATH = "/api/admin/identity-group-sync/dry-run";
const APPLY_PATH = "/api/admin/identity-group-sync/apply";

test.describe("@rbac Identity Group Sync dry-run/apply", () => {
  test("admins can dry-run and apply enterprise group sync; non-admins are denied", async ({
    persona,
    apiContext,
    identityGroups,
    identityGroupSyncRule,
  }) => {
    const group = identityGroups.find((candidate) => candidate.externalGroupId === "eng-platform-users");
    expect(group, "fixture group eng-platform-users must exist").toBeTruthy();

    const dryRunPayload = {
      groups: [
        {
          provider_id: group!.providerId,
          external_group_id: group!.externalGroupId,
          display_name: group!.displayName,
          normalized_name: group!.displayName.toLowerCase(),
          status: "active",
          members: group!.members.map((member) => ({
            subject: member.subject,
            email: member.email,
            display_name: member.displayName,
            active: member.active,
          })),
        },
      ],
      rules: [
        {
          id: identityGroupSyncRule.id,
          provider_id: identityGroupSyncRule.providerId,
          name: identityGroupSyncRule.name,
          priority: identityGroupSyncRule.priority,
          enabled: true,
          review_status: "enabled",
          include_patterns: identityGroupSyncRule.includePatterns,
          exclude_patterns: identityGroupSyncRule.excludePatterns,
          team_name_template: identityGroupSyncRule.teamNameTemplate,
          team_slug_template: identityGroupSyncRule.teamSlugTemplate,
          role_map: identityGroupSyncRule.roleMap,
          auto_create_team: identityGroupSyncRule.autoCreateTeam,
          created_by: "playwright",
          created_at: new Date().toISOString(),
          updated_by: "playwright",
          updated_at: new Date().toISOString(),
        },
      ],
      existing_teams: [],
      existing_membership_sources: [],
    };

    const dryRunResponse = await apiContext.post(DRY_RUN_PATH, { data: dryRunPayload });

    if (persona !== "alice_admin") {
      expect(dryRunResponse.status(), `${persona} should not dry-run identity sync`).toBe(403);
      return;
    }

    expect(dryRunResponse.status()).toBe(200);
    const dryRunBody = await dryRunResponse.json();
    const dryRun = dryRunBody.data?.dry_run;
    expect(dryRun?.matched_groups).toHaveLength(1);
    expect(dryRun?.membership_sources_to_add.length).toBeGreaterThan(0);
    expect(dryRun?.conflicts).toEqual([]);

    const applyResponse = await apiContext.post(APPLY_PATH, {
      data: { reviewed: true, dry_run: dryRun },
    });
    expect(applyResponse.status()).toBe(200);
    const applyBody = await applyResponse.json();
    expect(applyBody.data?.run?.status).toBe("applied");
    expect(applyBody.data?.result?.membershipSourcesAdded).toBeGreaterThan(0);
  });
});
