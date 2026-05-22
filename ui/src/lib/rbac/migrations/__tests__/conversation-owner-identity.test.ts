import {
  applyConversationOwnerIdentityMigration,
  deriveConversationOwnerIdentityPlan,
} from "../conversation-owner-identity";

const now = "2026-05-18T06:00:00.000Z";

describe("conversation owner identity migration", () => {
  it("plans implicit owner_subject updates without OpenFGA owner tuples", () => {
    const plan = deriveConversationOwnerIdentityPlan({
      conversations: [
        { _id: "c1", owner_id: "alice@example.com" },
        { _id: "c2", owner_id: "bob@example.com", owner_subject: "bob-sub" },
        { _id: "c3", owner_id: "missing@example.com" },
      ],
      users: [
        { email: "alice@example.com", keycloak_sub: "alice-sub" },
        { email: "bob@example.com", keycloak_sub: "bob-sub" },
      ],
      now,
    });

    expect(plan.counts).toMatchObject({
      total_conversations: 3,
      already_normalized: 1,
      resolvable: 1,
      unresolved: 1,
      tuple_writes_planned: 0,
    });
    expect(plan.sample_diffs).toEqual([
      {
        collection: "conversations",
        id: "c1",
        before: { owner_id: "alice@example.com", owner_subject: null },
        after: { owner_id: "alice@example.com", owner_subject: "alice-sub", owner_identity_version: 2 },
      },
    ]);
    expect(plan.warnings).toContain("1 conversation owner email(s) could not be resolved to Keycloak subjects.");
  });

  it("applies owner_subject updates idempotently and records provenance", async () => {
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const result = await applyConversationOwnerIdentityMigration({
      conversations: [
        { _id: "c1", owner_id: "alice@example.com" },
        { _id: "c2", owner_id: "bob@example.com", owner_subject: "bob-sub" },
      ],
      users: [{ email: "alice@example.com", metadata: { keycloak_sub: "alice-sub" } }],
      conversationsCollection: { updateOne },
      actor: "admin@example.com",
      now,
    });

    expect(result.applied_counts).toMatchObject({
      conversations_updated: 1,
      tuple_writes_applied: 0,
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "c1", $or: [{ owner_subject: { $exists: false } }, { owner_subject: null }, { owner_subject: "" }] },
      {
        $set: {
          owner_subject: "alice-sub",
          owner_identity_version: 2,
          "metadata.owner_identity_migration": {
            migration_id: "conversation_owner_identity_v1",
            migrated_at: now,
            migrated_by: "admin@example.com",
            source_field: "owner_id",
          },
        },
      },
    );
  });
});
