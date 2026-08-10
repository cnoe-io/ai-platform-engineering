import type { ExternalGroup, IdentityGroupSyncRule } from "@/types/identity-group-sync";

import { planIdentityGroupSync } from "../../identity-group-sync-planner";

describe("identity group sync performance", () => {
  it("plans a 500-group dry run within an interactive budget", () => {
    const rule: IdentityGroupSyncRule = {
      id: "rule-platform",
      provider_id: "oidc-claims",
      name: "Platform groups",
      priority: 10,
      enabled: true,
      review_status: "enabled",
      include_patterns: ["^Engineering (?<team>Team [0-9]+) (?<role>Users)$"],
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
    const groups = Array.from({ length: 500 }, (_, index) => ({
      provider_id: "oidc-claims",
      external_group_id: `gid-${index}`,
      display_name: `Engineering Team ${index} Users`,
      normalized_name: `engineering team ${index} users`,
      status: "active",
      members: [
        {
          subject: `user-${index}`,
          email: `user-${index}@example.test`,
          display_name: `User ${index}`,
          active: true,
        },
      ],
    })) as Array<ExternalGroup & { members: Array<{ subject: string; email: string; display_name: string; active: boolean }> }>;

    const started = performance.now();
    const result = planIdentityGroupSync({
      groups,
      rules: [rule],
      existingTeams: [],
      existingMembershipSources: [],
      now: "2026-05-12T00:00:00.000Z",
      actor: "admin@example.test",
    });
    const elapsedMs = performance.now() - started;

    expect(result.teams_to_create).toHaveLength(500);
    expect(result.tuple_writes).toHaveLength(500);
    expect(elapsedMs).toBeLessThan(750);
  });
});
