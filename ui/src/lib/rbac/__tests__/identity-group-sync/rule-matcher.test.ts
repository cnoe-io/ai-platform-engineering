import type { ExternalGroup, IdentityGroupSyncRule } from "@/types/identity-group-sync";

import { evaluateIdentityGroupRules } from "../../identity-group-rule-matcher";

const baseRule: IdentityGroupSyncRule = {
  id: "rule-platform",
  provider_id: "oidc-claims",
  name: "Platform groups",
  priority: 10,
  enabled: true,
  review_status: "enabled",
  include_patterns: ["^Engineering (?<team>Platform) (?<role>Admins|Users)$"],
  exclude_patterns: ["Contractors"],
  team_name_template: "{{team}}",
  team_slug_template: "{{team}}",
  role_map: {
    Admins: "admin",
    Users: "member",
  },
  auto_create_team: true,
  created_by: "admin@example.test",
  created_at: "2026-05-12T00:00:00.000Z",
  updated_by: "admin@example.test",
  updated_at: "2026-05-12T00:00:00.000Z",
};

function group(displayName: string, id = displayName): ExternalGroup {
  return {
    provider_id: "oidc-claims",
    external_group_id: id,
    display_name: displayName,
    normalized_name: displayName.toLowerCase(),
    status: "active",
  };
}

describe("identity group rule matcher", () => {
  it("matches enabled rules by priority and renders deterministic team targets", async () => {
    const result = await evaluateIdentityGroupRules({
      groups: [group("Engineering Platform Admins")],
      rules: [baseRule],
      existingTeamSlugs: [],
    });

    expect(result.matches).toEqual([
      {
        group: group("Engineering Platform Admins"),
        rule: baseRule,
        captured: { team: "Platform", role: "Admins" },
        relationship: "admin",
        teamName: "Platform",
        teamSlug: "platform",
      },
    ]);
    expect(result.ignored).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("ignores excluded groups before include matching", async () => {
    const result = await evaluateIdentityGroupRules({
      groups: [group("Engineering Platform Contractors")],
      rules: [baseRule],
      existingTeamSlugs: [],
    });

    expect(result.matches).toEqual([]);
    expect(result.ignored).toEqual([
      {
        group: group("Engineering Platform Contractors"),
        reason: "excluded_by_rule",
        ruleId: "rule-platform",
      },
    ]);
  });

  it("matches generated slugs to existing teams instead of treating them as conflicts", async () => {
    const result = await evaluateIdentityGroupRules({
      groups: [group("Engineering Platform Users")],
      rules: [baseRule],
      existingTeamSlugs: ["platform"],
    });

    expect(result.matches).toEqual([
      expect.objectContaining({
        group: group("Engineering Platform Users"),
        teamSlug: "platform",
        relationship: "member",
      }),
    ]);
    expect(result.conflicts).toEqual([]);
  });
});
