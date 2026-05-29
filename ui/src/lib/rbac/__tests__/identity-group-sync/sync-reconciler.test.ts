const upsertTeamMembershipSource = jest.fn();
const markTeamMembershipSourceRemoved = jest.fn();
const writeOpenFgaTuples = jest.fn();
const teamsFind = jest.fn();
const teamsInsertOne = jest.fn();
const teamsDeleteOne = jest.fn();
const teamsUpdateOne = jest.fn();

jest.mock("../../team-membership-source-store", () => ({
  upsertTeamMembershipSource: (...args: unknown[]) => upsertTeamMembershipSource(...args),
  markTeamMembershipSourceRemoved: (...args: unknown[]) => markTeamMembershipSourceRemoved(...args),
}));

jest.mock("../../openfga", () => ({
  // OpenFgaWriteError is a real class export; tests that exercise the
  // rollback path import it from the reconciler's re-export.
  OpenFgaWriteError: class OpenFgaWriteError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "OpenFgaWriteError";
      this.status = status;
    }
  },
  writeOpenFgaTuples: (...args: unknown[]) => writeOpenFgaTuples(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => {
    if (name === "teams") {
      return {
        find: (...args: unknown[]) => teamsFind(...args),
        insertOne: (...args: unknown[]) => teamsInsertOne(...args),
        deleteOne: (...args: unknown[]) => teamsDeleteOne(...args),
        updateOne: (...args: unknown[]) => teamsUpdateOne(...args),
      };
    }
    return {};
  }),
}));

describe("identity group sync apply reconciler", () => {
  beforeEach(() => {
    jest.resetModules();
    upsertTeamMembershipSource.mockReset().mockResolvedValue(undefined);
    markTeamMembershipSourceRemoved.mockReset().mockResolvedValue(undefined);
    writeOpenFgaTuples.mockReset().mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    teamsFind.mockReset().mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    teamsInsertOne.mockReset().mockResolvedValue({ insertedId: "created-team-id" });
    teamsDeleteOne.mockReset().mockResolvedValue({ deletedCount: 1 });
    teamsUpdateOne.mockReset().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it("persists membership source changes and writes OpenFGA tuple diff", async () => {
    const { applyIdentityGroupSyncPlan } = await import("../../identity-group-sync-reconciler");

    await expect(
      applyIdentityGroupSyncPlan({
        plan: {
          matched_groups: [],
          ignored_groups: [],
          teams_to_create: [],
          membership_sources_to_add: [
            {
              team_id: "team-1",
              team_slug: "platform",
              user_subject: "bob-sub",
              relationship: "member",
              source_type: "oidc_claim",
              managed: true,
              status: "active",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          membership_sources_to_remove: [],
          tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:platform" }],
          tuple_deletes: [],
          skipped_users: [],
          conflicts: [],
        },
        actor: "admin@example.test",
        now: "2026-05-12T01:00:00.000Z",
      })
    ).resolves.toEqual({
      teamsCreated: 0,
      membershipSourcesAdded: 1,
      membershipSourcesRemoved: 0,
      tupleWrites: 1,
      tupleDeletes: 0,
      openFgaEnabled: true,
    });

    expect(upsertTeamMembershipSource).toHaveBeenCalledTimes(1);
    expect(writeOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "user:bob-sub", relation: "member", object: "team:platform" }],
      deletes: [],
    });
  });

  it("creates missing teams during reviewed apply and uses created ids for membership sources", async () => {
    const { applyIdentityGroupSyncPlan } = await import("../../identity-group-sync-reconciler");

    await expect(
      applyIdentityGroupSyncPlan({
        plan: {
          matched_groups: [],
          ignored_groups: [],
          teams_to_create: [{ slug: "caipe-users", name: "caipe-users", source_group_id: "caipe-users" }],
          membership_sources_to_add: [
            {
              team_id: "caipe-users",
              team_slug: "caipe-users",
              user_subject: "bob-sub",
              user_email: "bob@example.test",
              relationship: "member",
              source_type: "oidc_claim",
              provider_id: "oidc-claims",
              external_group_id: "caipe-users",
              sync_rule_id: "rule-caipe-users",
              managed: true,
              status: "active",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          membership_sources_to_remove: [],
          tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:caipe-users" }],
          tuple_deletes: [],
          skipped_users: [],
          conflicts: [],
        },
        actor: "admin@example.test",
        now: "2026-05-12T01:00:00.000Z",
      })
    ).resolves.toEqual(expect.objectContaining({ teamsCreated: 1, membershipSourcesAdded: 1 }));

    expect(teamsInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "caipe-users",
        name: "caipe-users",
        source: "identity_group_sync",
        status: "active",
        created_by: "admin@example.test",
        source_group_id: "caipe-users",
      })
    );
    expect(upsertTeamMembershipSource).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: "created-team-id",
        team_slug: "caipe-users",
        user_subject: "bob-sub",
      })
    );
  });

  it("does NOT touch teams.members[] when upserting membership sources (post commit 6/8)", async () => {
    // Commit 6/8 of the canonical-team-membership refactor (spec
    // 2026-05-26-canonical-team-membership) removed the
    // syncTeamEmbeddedMember() denormalization step. The reconciler
    // now writes only to team_membership_sources + OpenFGA; the Admin
    // UI's member-count badge reads `team.member_count` (aggregated
    // server-side from the canonical store, see commit 4/8). This
    // regression test pins that contract: the legacy embedded array
    // must not see any $push, $pull, or $addToSet.
    const { applyIdentityGroupSyncPlan } = await import(
      "../../identity-group-sync-reconciler"
    );

    await applyIdentityGroupSyncPlan({
      plan: {
        matched_groups: [],
        ignored_groups: [],
        teams_to_create: [],
        membership_sources_to_add: [
          {
            team_id: "team-1",
            team_slug: "platform",
            user_subject: "bob-sub",
            user_email: "bob@example.test",
            relationship: "member",
            source_type: "oidc_claim",
            managed: true,
            status: "active",
            created_at: "2026-05-12T00:00:00.000Z",
          },
        ],
        membership_sources_to_remove: [],
        tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:platform" }],
        tuple_deletes: [],
        skipped_users: [],
        conflicts: [],
      },
      actor: "admin@example.test",
      now: "2026-05-12T01:00:00.000Z",
    });

    // Negative assertion: no embedded-member writes. The canonical
    // upsert and OpenFGA tuple write are validated in other tests.
    expect(teamsUpdateOne).not.toHaveBeenCalled();
    expect(upsertTeamMembershipSource).toHaveBeenCalledTimes(1);
  });

  it("does NOT touch teams.members[] when removing membership sources (post commit 6/8)", async () => {
    // Symmetric to the upsert case above — the reconciler must not
    // $pull from the legacy embedded array on removal either.
    const { applyIdentityGroupSyncPlan } = await import(
      "../../identity-group-sync-reconciler"
    );

    await applyIdentityGroupSyncPlan({
      plan: {
        matched_groups: [],
        ignored_groups: [],
        teams_to_create: [],
        membership_sources_to_add: [],
        membership_sources_to_remove: [
          {
            team_id: "team-1",
            team_slug: "platform",
            user_subject: "carol-sub",
            user_email: "carol@example.test",
            relationship: "member",
            source_type: "oidc_claim",
            managed: true,
            status: "active",
            created_at: "2026-05-12T00:00:00.000Z",
          },
        ],
        tuple_writes: [],
        tuple_deletes: [],
        skipped_users: [],
        conflicts: [],
      },
      actor: "admin@example.test",
      now: "2026-05-12T01:00:00.000Z",
    });

    expect(teamsUpdateOne).not.toHaveBeenCalled();
  });

  it("skips embedded-member sync when user_email is missing (defense in depth)", async () => {
    // Pre-commit-6 this test guarded `syncTeamEmbeddedMember`'s early
    // return for synthetic / partial source rows. With the helper
    // removed the surface still has to behave: no team-doc writes, but
    // the canonical-source upsert must still record the membership
    // (audit-trail invariant). The test is unchanged in intent.
    const { applyIdentityGroupSyncPlan } = await import(
      "../../identity-group-sync-reconciler"
    );

    await applyIdentityGroupSyncPlan({
      plan: {
        matched_groups: [],
        ignored_groups: [],
        teams_to_create: [],
        membership_sources_to_add: [
          {
            team_id: "team-1",
            team_slug: "platform",
            user_subject: "no-email-sub",
            // user_email intentionally omitted.
            relationship: "member",
            source_type: "oidc_claim",
            managed: true,
            status: "active",
            created_at: "2026-05-12T00:00:00.000Z",
          },
        ],
        membership_sources_to_remove: [],
        tuple_writes: [],
        tuple_deletes: [],
        skipped_users: [],
        conflicts: [],
      },
      actor: "admin@example.test",
      now: "2026-05-12T01:00:00.000Z",
    });

    expect(teamsUpdateOne).not.toHaveBeenCalled();
    expect(upsertTeamMembershipSource).toHaveBeenCalledTimes(1);
  });

  it("rolls back created teams AND upserted membership sources when OpenFGA tuple write fails", async () => {
    // Simulate the real production failure: Phase 1 succeeded (team
    // doc inserted, membership source upserted) but writeOpenFgaTuples
    // throws on the way to OpenFGA. Both Mongo writes from this call
    // must be reverted before the error is rethrown.
    const { applyIdentityGroupSyncPlan, OpenFgaWriteError } = await import(
      "../../identity-group-sync-reconciler"
    );
    writeOpenFgaTuples.mockRejectedValueOnce(
      new OpenFgaWriteError("OpenFGA tuple write failed: 400 exceeded_entity_limit", 400),
    );

    await expect(
      applyIdentityGroupSyncPlan({
        plan: {
          matched_groups: [],
          ignored_groups: [],
          teams_to_create: [
            { slug: "caipe-users", name: "caipe-users", source_group_id: "caipe-users" },
          ],
          membership_sources_to_add: [
            {
              team_id: "caipe-users",
              team_slug: "caipe-users",
              user_subject: "bob-sub",
              user_email: "bob@example.test",
              relationship: "member",
              source_type: "oidc_claim",
              provider_id: "oidc-claims",
              external_group_id: "caipe-users",
              sync_rule_id: "rule-caipe-users",
              managed: true,
              status: "active",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          membership_sources_to_remove: [],
          tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:caipe-users" }],
          tuple_deletes: [],
          skipped_users: [],
          conflicts: [],
        },
        actor: "admin@example.test",
        now: "2026-05-12T01:00:00.000Z",
      }),
    ).rejects.toThrow(/OpenFGA tuple write failed/);

    // Phase 2 rollback: the upserted membership source got marked removed
    // with the rollback-tagged actor.
    expect(markTeamMembershipSourceRemoved).toHaveBeenCalledWith(
      expect.objectContaining({
        team_slug: "caipe-users",
        user_subject: "bob-sub",
      }),
      "admin@example.test-rollback",
      "2026-05-12T01:00:00.000Z",
    );
    // Phase 1 rollback: the team doc we inserted got deleted by slug.
    expect(teamsDeleteOne).toHaveBeenCalledWith({ slug: "caipe-users" });
  });

  it("does not delete pre-existing teams during rollback (only those created by this call)", async () => {
    // The team already exists by slug; this call's plan asks to create
    // it but ensureIdentitySyncTeams sees the existing row and skips
    // insert. When OpenFGA fails, rollback must NOT delete the
    // pre-existing team — it wasn't ours to delete.
    teamsFind.mockReturnValueOnce({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: "preexisting-team-id", slug: "caipe-users", name: "caipe-users" },
        ]),
      }),
    });
    const { applyIdentityGroupSyncPlan, OpenFgaWriteError } = await import(
      "../../identity-group-sync-reconciler"
    );
    writeOpenFgaTuples.mockRejectedValueOnce(
      new OpenFgaWriteError("OpenFGA tuple write failed: 500 internal", 500),
    );

    await expect(
      applyIdentityGroupSyncPlan({
        plan: {
          matched_groups: [],
          ignored_groups: [],
          teams_to_create: [
            { slug: "caipe-users", name: "caipe-users", source_group_id: "caipe-users" },
          ],
          membership_sources_to_add: [
            {
              team_id: "caipe-users",
              team_slug: "caipe-users",
              user_subject: "bob-sub",
              relationship: "member",
              source_type: "oidc_claim",
              managed: true,
              status: "active",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          membership_sources_to_remove: [],
          tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:caipe-users" }],
          tuple_deletes: [],
          skipped_users: [],
          conflicts: [],
        },
        actor: "admin@example.test",
        now: "2026-05-12T01:00:00.000Z",
      }),
    ).rejects.toThrow();

    expect(teamsInsertOne).not.toHaveBeenCalled();
    expect(teamsDeleteOne).not.toHaveBeenCalled();
  });

  it("re-upserts removed membership sources during rollback", async () => {
    // Symmetric to the upsert-rollback case: when a remove was applied
    // in Phase 2 and then OpenFGA fails, the rollback must flip the
    // removed source back to active so we don't drop a previously-good
    // membership.
    const { applyIdentityGroupSyncPlan, OpenFgaWriteError } = await import(
      "../../identity-group-sync-reconciler"
    );
    writeOpenFgaTuples.mockRejectedValueOnce(
      new OpenFgaWriteError("OpenFGA tuple write failed: 400 entity_limit", 400),
    );

    await expect(
      applyIdentityGroupSyncPlan({
        plan: {
          matched_groups: [],
          ignored_groups: [],
          teams_to_create: [],
          membership_sources_to_add: [],
          membership_sources_to_remove: [
            {
              team_id: "team-1",
              team_slug: "platform",
              user_subject: "carol-sub",
              relationship: "admin",
              source_type: "oidc_claim",
              managed: true,
              status: "active",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          tuple_writes: [],
          tuple_deletes: [{ user: "user:carol-sub", relation: "admin", object: "team:platform" }],
          skipped_users: [],
          conflicts: [],
        },
        actor: "admin@example.test",
        now: "2026-05-12T01:00:00.000Z",
      }),
    ).rejects.toThrow();

    // The remove was applied, so rollback re-upserts as active.
    expect(upsertTeamMembershipSource).toHaveBeenLastCalledWith(
      expect.objectContaining({
        team_slug: "platform",
        user_subject: "carol-sub",
        status: "active",
        last_applied_at: "2026-05-12T01:00:00.000Z",
      }),
    );
  });

  it("logs and surfaces the original error when rollback itself fails", async () => {
    // Edge case: rollback throws (e.g. Mongo unreachable mid-rollback).
    // The reconciler must still surface the original OpenFGA error to
    // the caller, and the rollback failure must be logged but swallowed.
    const consoleErrSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { applyIdentityGroupSyncPlan, OpenFgaWriteError } = await import(
        "../../identity-group-sync-reconciler"
      );
      writeOpenFgaTuples.mockRejectedValueOnce(
        new OpenFgaWriteError("OpenFGA tuple write failed: 400 entity_limit", 400),
      );
      markTeamMembershipSourceRemoved.mockRejectedValueOnce(
        new Error("mongo connection lost during rollback"),
      );

      await expect(
        applyIdentityGroupSyncPlan({
          plan: {
            matched_groups: [],
            ignored_groups: [],
            teams_to_create: [],
            membership_sources_to_add: [
              {
                team_id: "team-1",
                team_slug: "platform",
                user_subject: "bob-sub",
                relationship: "member",
                source_type: "oidc_claim",
                managed: true,
                status: "active",
                created_at: "2026-05-12T00:00:00.000Z",
              },
            ],
            membership_sources_to_remove: [],
            tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:platform" }],
            tuple_deletes: [],
            skipped_users: [],
            conflicts: [],
          },
          actor: "admin@example.test",
          now: "2026-05-12T01:00:00.000Z",
        }),
      ).rejects.toThrow(/OpenFGA tuple write failed/);

      // Original error surfaces; rollback failure is logged.
      expect(consoleErrSpy).toHaveBeenCalledWith(
        expect.stringContaining("phase 2 rollback failed"),
        expect.objectContaining({
          rollbackErr: expect.any(Error),
          originalError: expect.any(Error),
        }),
      );
    } finally {
      consoleErrSpy.mockRestore();
    }
  });
});
