import type { TeamMembershipSource } from "@/types/identity-group-sync";

import { reconcileTeamMembershipSources } from "../../membership-reconciler";

function source(overrides: Partial<TeamMembershipSource>): TeamMembershipSource {
  return {
    team_id: "team-1",
    team_slug: "platform",
    user_subject: "user-sub",
    user_email: "user@example.test",
    relationship: "member",
    source_type: "manual",
    managed: false,
    status: "active",
    created_at: "2026-05-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("team membership source reconciler", () => {
  it("adds new managed sources and materializes user-team tuples", () => {
    const result = reconcileTeamMembershipSources({
      existingSources: [],
      desiredSources: [
        source({
          source_type: "oidc_claim",
          managed: true,
          sync_rule_id: "rule-platform",
        }),
      ],
      now: "2026-05-12T01:00:00.000Z",
    });

    expect(result.sourcesToAdd).toHaveLength(1);
    expect(result.tupleWrites).toEqual([
      {
        user: "user:user-sub",
        relation: "member",
        object: "team:platform",
      },
    ]);
  });

  it("removes only managed sources and preserves manual access", () => {
    const result = reconcileTeamMembershipSources({
      existingSources: [
        source({ source_type: "manual", managed: false }),
        source({ source_type: "oidc_claim", managed: true, sync_rule_id: "rule-platform" }),
      ],
      desiredSources: [],
      now: "2026-05-12T01:00:00.000Z",
    });

    expect(result.sourcesToRemove).toEqual([
      source({
        source_type: "oidc_claim",
        managed: true,
        sync_rule_id: "rule-platform",
        status: "removed",
        removed_at: "2026-05-12T01:00:00.000Z",
      }),
    ]);
    expect(result.tupleDeletes).toEqual([]);
  });

  it("deletes the user-team tuple when the last active source is removed", () => {
    const result = reconcileTeamMembershipSources({
      existingSources: [source({ source_type: "oidc_claim", managed: true })],
      desiredSources: [],
      now: "2026-05-12T01:00:00.000Z",
    });

    expect(result.tupleDeletes).toEqual([
      {
        user: "user:user-sub",
        relation: "member",
        object: "team:platform",
      },
    ]);
  });
});
