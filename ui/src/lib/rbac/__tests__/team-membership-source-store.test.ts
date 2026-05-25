/**
 * Unit tests for the team-membership source store, focused on the
 * `markTeamMembershipSourceRemoved` filter behaviour.
 *
 * The historical bug this guards against: the manual-delete path constructs
 * a synthetic source from `(team, email, relationship)` only — it does not
 * carry the original Keycloak `user_subject`. The old filter required an
 * exact `user_subject` match, so the original active source row was never
 * marked removed and the team would show "OpenFGA: drifted" for the user
 * forever. See ui/src/app/api/admin/teams/[id]/members/route.ts DELETE.
 */

import type { TeamMembershipSource } from "@/types/identity-group-sync";

const updateManyMock = jest.fn();

jest.mock("../mongo-collections", () => ({
  getRbacCollection: jest.fn(async () => ({
    updateMany: updateManyMock,
  })),
}));

import { markTeamMembershipSourceRemoved } from "../team-membership-source-store";

function baseSource(overrides: Partial<TeamMembershipSource> = {}): TeamMembershipSource {
  return {
    team_id: "507f1f77bcf86cd799439011",
    team_slug: "platform",
    user_email: "synced@example.com",
    user_subject: undefined,
    relationship: "member",
    source_type: "manual",
    managed: false,
    status: "active",
    first_seen_at: "2026-05-22T00:00:00.000Z",
    last_seen_at: "2026-05-22T00:00:00.000Z",
    last_applied_at: "2026-05-22T00:00:00.000Z",
    created_by: "admin@example.com",
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  updateManyMock.mockReset();
  updateManyMock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
});

describe("markTeamMembershipSourceRemoved", () => {
  it("falls back to user_email when user_subject is missing (manual-delete synthetic source)", async () => {
    await markTeamMembershipSourceRemoved(
      baseSource({ user_subject: undefined }),
      "admin@example.com",
      "2026-05-22T05:30:00.000Z",
    );

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const [filter, update] = updateManyMock.mock.calls[0];
    expect(filter).toMatchObject({
      team_slug: "platform",
      user_email: "synced@example.com",
      relationship: "member",
      source_type: "manual",
      status: "active",
    });
    // Must NOT pin user_subject: undefined — Mongo would refuse to match the
    // original row that has a real subject populated.
    expect(filter.user_subject).toBeUndefined();
    expect(Object.keys(filter)).not.toContain("user_subject");
    // Provenance fields default to "field absent or null".
    expect(filter.provider_id).toEqual({ $in: [null, undefined] });
    expect(filter.external_group_id).toEqual({ $in: [null, undefined] });
    expect(filter.sync_rule_id).toEqual({ $in: [null, undefined] });
    expect(update).toEqual({
      $set: {
        status: "removed",
        removed_by: "admin@example.com",
        removed_at: "2026-05-22T05:30:00.000Z",
      },
    });
  });

  it("prefers user_subject when it is set", async () => {
    await markTeamMembershipSourceRemoved(
      baseSource({ user_subject: "kc-synced" }),
      "admin@example.com",
      "2026-05-22T05:30:00.000Z",
    );

    const [filter] = updateManyMock.mock.calls[0];
    expect(filter.user_subject).toBe("kc-synced");
    expect(Object.keys(filter)).not.toContain("user_email");
  });

  it("pins provenance fields when provided so cross-provider rows are not collapsed", async () => {
    await markTeamMembershipSourceRemoved(
      baseSource({
        source_type: "okta",
        managed: true,
        user_subject: "kc-synced",
        provider_id: "okta-main",
        external_group_id: "00g-platform",
        sync_rule_id: "rule-1",
      }),
      "sync",
      "2026-05-22T05:30:00.000Z",
    );

    const [filter] = updateManyMock.mock.calls[0];
    expect(filter).toMatchObject({
      team_slug: "platform",
      source_type: "okta",
      user_subject: "kc-synced",
      provider_id: "okta-main",
      external_group_id: "00g-platform",
      sync_rule_id: "rule-1",
      status: "active",
    });
  });

  it("refuses to update rows when both user_subject and user_email are missing", async () => {
    const result = await markTeamMembershipSourceRemoved(
      baseSource({ user_subject: undefined, user_email: undefined }),
      "admin@example.com",
      "2026-05-22T05:30:00.000Z",
    );

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(result).toEqual({ matchedCount: 0, modifiedCount: 0 });
  });

  it("sweeps duplicate rows with updateMany so partial-failure dups all retire together", async () => {
    updateManyMock.mockResolvedValueOnce({ matchedCount: 2, modifiedCount: 2 });

    const result = await markTeamMembershipSourceRemoved(
      baseSource({ user_subject: undefined }),
      "admin@example.com",
      "2026-05-22T05:30:00.000Z",
    );

    expect(result).toEqual({ matchedCount: 2, modifiedCount: 2 });
  });
});
