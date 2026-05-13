import type { ExternalGroup, IdentityGroupSyncRule } from "@/types/identity-group-sync";

import { planIdentityGroupSync } from "../../identity-group-sync-planner";

const rule: IdentityGroupSyncRule = {
  id: "rule-platform",
  provider_id: "oidc-claims",
  name: "Platform groups",
  priority: 10,
  enabled: true,
  review_status: "enabled",
  include_patterns: ["^Engineering (?<team>Platform) (?<role>Users)$"],
  exclude_patterns: [],
  team_name_template: "{{team}}",
  team_slug_template: "{{team}}",
  role_map: { Users: "member" },
  auto_create_team: true,
  created_by: "admin@example.test",
  created_at: "2026-05-12T00:00:00.000Z",
  updated_by: "admin@example.test",
  updated_at: "2026-05-12T00:00:00.000Z",
};

const group: ExternalGroup & {
  members: Array<{ subject?: string; email: string; display_name: string; active: boolean }>;
} = {
  provider_id: "oidc-claims",
  external_group_id: "gid-platform-users",
  display_name: "Engineering Platform Users",
  normalized_name: "engineering platform users",
  status: "active",
  members: [
    {
      subject: "bob-sub",
      email: "bob@example.test",
      display_name: "Bob User",
      active: true,
    },
    {
      email: "unlinked@example.test",
      display_name: "Unlinked User",
      active: true,
    },
  ],
};

describe("identity group sync dry-run planner", () => {
  it("plans team creation, membership sources, skipped users, and member tuples", () => {
    const result = planIdentityGroupSync({
      groups: [group],
      rules: [rule],
      existingTeams: [],
      existingMembershipSources: [],
      now: "2026-05-12T01:00:00.000Z",
      actor: "admin@example.test",
    });

    expect(result.teams_to_create).toEqual([
      { slug: "platform", name: "Platform", source_group_id: "gid-platform-users" },
    ]);
    expect(result.membership_sources_to_add).toEqual([
      expect.objectContaining({
        team_slug: "platform",
        user_subject: "bob-sub",
        user_email: "bob@example.test",
        relationship: "member",
        source_type: "oidc_claim",
        managed: true,
        status: "active",
      }),
    ]);
    expect(result.skipped_users).toEqual([
      {
        source_group_id: "gid-platform-users",
        user_identifier: "unlinked@example.test",
        reason: "missing_subject",
      },
    ]);
    expect(result.tuple_writes).toEqual([
      { user: "user:bob-sub", relation: "member", object: "team:platform" },
    ]);
  });
});
