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

  it("re-emits tuple writes for RETAINED existing sources, not just adds (self-heal)", () => {
    // Regression for the interrupted-sync drift: a prior run upserted the
    // Mongo source row but its OpenFGA write never landed (pod SIGKILLed
    // mid-reconcile). On the next run the row is "existing" + still desired,
    // so it lands in neither sourcesToAdd nor sourcesToRemove. The old
    // add-only diff produced zero writes and the tuple stayed missing forever.
    // The reconciler must now re-emit the write so writeOpenFgaTuples can
    // backfill the missing tuple (present tuples are dropped by its read-back).
    const stranded = source({
      source_type: "okta",
      managed: true,
      sync_rule_id: "rule-platform",
      external_group_id: "platform",
    });
    const result = reconcileTeamMembershipSources({
      existingSources: [stranded],
      desiredSources: [stranded],
      now: "2026-05-12T01:00:00.000Z",
    });

    // Nothing changes at the Mongo layer — the row is unchanged.
    expect(result.sourcesToAdd).toEqual([]);
    expect(result.sourcesToRemove).toEqual([]);
    // ...but the tuple is re-emitted so a missing one gets backfilled.
    expect(result.tupleWrites).toEqual([
      {
        user: "user:user-sub",
        relation: "member",
        object: "team:platform",
      },
    ]);
  });

  it("collapses duplicate (user, relation, team) across multiple retained sources", () => {
    // A user can hold the same access via two sources (e.g. manual + okta).
    // The re-emitted write set must dedupe so we don't send the same tuple
    // twice to OpenFGA in one diff.
    const manual = source({ source_type: "manual", managed: false });
    const okta = source({
      source_type: "okta",
      managed: true,
      sync_rule_id: "rule-platform",
      external_group_id: "platform",
    });
    const result = reconcileTeamMembershipSources({
      existingSources: [manual, okta],
      desiredSources: [manual, okta],
      now: "2026-05-12T01:00:00.000Z",
    });

    expect(result.tupleWrites).toEqual([
      {
        user: "user:user-sub",
        relation: "member",
        object: "team:platform",
      },
    ]);
  });
});
