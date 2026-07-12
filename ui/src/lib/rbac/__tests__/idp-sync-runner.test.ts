/**
 * @jest-environment node
 */
// Unit tests for the IdP directory sync execution path. Focuses on the
// runner's own logic added alongside Okta name/membership upserts: splitting
// an Okta display_name into firstName/lastName for provisionShellUser,
// per-email sub-resolution caching, and the error-handling contract around
// both a single member's provisioning failure and a whole-run failure.
// Dependencies (planner, reconciler, keycloak-admin, idp-sync-store, mongo)
// are all mocked — this file does not re-test their internals.

const getCollection = jest.fn();
const getIdpSyncSettings = jest.fn();
const heartbeatIdpSyncRun = jest.fn();
const insertIdpSyncRun = jest.fn();
const listRunningIdpSyncRuns = jest.fn();
const reapStaleIdpSyncRuns = jest.fn();
const updateIdpSyncRun = jest.fn();
const fetchExternalGroupsForProvider = jest.fn();
const listIdentityGroupSyncRules = jest.fn();
const listActiveTeamMembershipSourcesForProvider = jest.fn();
const provisionShellUser = jest.fn();
const linkFederatedIdentity = jest.fn();
const planIdentityGroupSync = jest.fn();
const applyIdentityGroupSyncPlan = jest.fn();
const stripArchivedTeamResourceGrants = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => getCollection(...args),
}));

jest.mock("@/lib/rbac/identity-group-sync-planner", () => ({
  planIdentityGroupSync: (...args: unknown[]) => planIdentityGroupSync(...args),
}));

jest.mock("@/lib/rbac/identity-group-sync-reconciler", () => ({
  applyIdentityGroupSyncPlan: (...args: unknown[]) => applyIdentityGroupSyncPlan(...args),
}));

jest.mock("@/lib/rbac/identity-group-sync-rule-store", () => ({
  listIdentityGroupSyncRules: (...args: unknown[]) => listIdentityGroupSyncRules(...args),
}));

jest.mock("@/lib/rbac/idp-connectors", () => ({
  fetchExternalGroupsForProvider: (...args: unknown[]) => fetchExternalGroupsForProvider(...args),
}));

jest.mock("@/lib/rbac/idp-sync-store", () => ({
  HEARTBEAT_INTERVAL_MS: 20_000,
  getIdpSyncSettings: (...args: unknown[]) => getIdpSyncSettings(...args),
  heartbeatIdpSyncRun: (...args: unknown[]) => heartbeatIdpSyncRun(...args),
  insertIdpSyncRun: (...args: unknown[]) => insertIdpSyncRun(...args),
  listRunningIdpSyncRuns: (...args: unknown[]) => listRunningIdpSyncRuns(...args),
  reapStaleIdpSyncRuns: (...args: unknown[]) => reapStaleIdpSyncRuns(...args),
  updateIdpSyncRun: (...args: unknown[]) => updateIdpSyncRun(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  provisionShellUser: (...args: unknown[]) => provisionShellUser(...args),
  linkFederatedIdentity: (...args: unknown[]) => linkFederatedIdentity(...args),
}));

jest.mock("@/lib/rbac/archived-team-grants", () => ({
  stripArchivedTeamResourceGrants: (...args: unknown[]) => stripArchivedTeamResourceGrants(...args),
}));

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  listActiveTeamMembershipSourcesForProvider: (...args: unknown[]) =>
    listActiveTeamMembershipSourcesForProvider(...args),
}));

import { createSyncRun, executeSyncRun } from "../idp-sync-runner";

function teamsCollectionStub() {
  return {
    find: jest.fn().mockReturnValue({
      project: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    }),
  };
}

describe("idp-sync-runner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCollection.mockResolvedValue(teamsCollectionStub());
    // A group filter is present by default so the (pre-existing, separately
    // covered) full-sync orphan sweep never runs and these tests stay scoped
    // to the runner's own new upsert logic.
    getIdpSyncSettings.mockResolvedValue({
      provider_id: "okta",
      enabled: true,
      schedule_mode: "interval",
      sync_interval_minutes: 60,
      group_filter: "type eq \"okta_group\"",
      updated_by: "test",
      updated_at: new Date(0).toISOString(),
    });
    heartbeatIdpSyncRun.mockResolvedValue(undefined);
    updateIdpSyncRun.mockResolvedValue(undefined);
    fetchExternalGroupsForProvider.mockResolvedValue([]);
    listIdentityGroupSyncRules.mockResolvedValue([]);
    listActiveTeamMembershipSourcesForProvider.mockResolvedValue([]);
    provisionShellUser.mockResolvedValue({ sub: "sub-1", created: false });
    linkFederatedIdentity.mockResolvedValue(undefined);
    planIdentityGroupSync.mockReturnValue({ matched_groups: [] });
    applyIdentityGroupSyncPlan.mockResolvedValue({
      teamsCreated: 0,
      membershipSourcesAdded: 0,
      membershipSourcesRemoved: 0,
      membershipSourcesRefreshed: 0,
      tupleWrites: 0,
      tupleDeletes: 0,
      openFgaEnabled: true,
      teamsArchived: 0,
    });
  });

  describe("createSyncRun", () => {
    it("refuses when a run is already active for the connector", async () => {
      listRunningIdpSyncRuns.mockResolvedValue([{ id: "existing-run" }]);

      const result = await createSyncRun({ provider: "okta", actor: "admin", triggeredBy: "manual" });

      expect(result).toEqual({ status: "already_running", runId: "existing-run" });
      expect(insertIdpSyncRun).not.toHaveBeenCalled();
    });

    it("reaps stale runs before checking, and creates a new run when none is active", async () => {
      listRunningIdpSyncRuns.mockImplementation(async () => []);

      const result = await createSyncRun({ provider: "okta", actor: "admin", triggeredBy: "manual" });

      expect(reapStaleIdpSyncRuns).toHaveBeenCalledWith("okta", expect.any(Number));
      expect(insertIdpSyncRun).toHaveBeenCalledWith(
        expect.objectContaining({ provider_id: "okta", status: "running", triggered_by: "manual", triggered_by_user: "admin" })
      );
      expect(result.status).toBe("created");
    });

    it("resolves a concurrent-insert race by deferring to the earliest run", async () => {
      listRunningIdpSyncRuns
        .mockResolvedValueOnce([]) // pre-check: nothing running yet
        .mockResolvedValueOnce([{ id: "other-runner-won" }]); // post-insert re-read: someone else won

      const result = await createSyncRun({ provider: "okta", actor: "admin", triggeredBy: "manual" });

      expect(result).toEqual({ status: "already_running", runId: "other-runner-won" });
      expect(updateIdpSyncRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "failed", error_message: expect.stringContaining("Superseded") })
      );
    });
  });

  describe("executeSyncRun: Okta name upsert into provisionShellUser", () => {
    it("splits a multi-word display_name into firstName and the remainder as lastName", async () => {
      fetchExternalGroupsForProvider.mockResolvedValue([
        { id: "g1", name: "Group 1", members: [{ email: "Mary@Example.com", active: true, display_name: "Mary Jo Smith" }] },
      ]);

      await executeSyncRun("run-1", "okta", "admin");

      expect(provisionShellUser).toHaveBeenCalledWith({
        email: "mary@example.com",
        source: "idp-sync:okta",
        firstName: "Mary",
        lastName: "Jo Smith",
      });
    });

    it("treats a single-word display_name as firstName only", async () => {
      fetchExternalGroupsForProvider.mockResolvedValue([
        { id: "g1", name: "Group 1", members: [{ email: "solo@example.com", active: true, display_name: "Madonna" }] },
      ]);

      await executeSyncRun("run-1", "okta", "admin");

      expect(provisionShellUser).toHaveBeenCalledWith({
        email: "solo@example.com",
        source: "idp-sync:okta",
        firstName: "Madonna",
        lastName: undefined,
      });
    });

    it("passes undefined firstName/lastName when Okta has no display_name", async () => {
      fetchExternalGroupsForProvider.mockResolvedValue([
        { id: "g1", name: "Group 1", members: [{ email: "noname@example.com", active: true }] },
      ]);

      await executeSyncRun("run-1", "okta", "admin");

      expect(provisionShellUser).toHaveBeenCalledWith({
        email: "noname@example.com",
        source: "idp-sync:okta",
        firstName: undefined,
        lastName: undefined,
      });
    });

    it("resolves each unique email once and reuses the cached sub across groups", async () => {
      fetchExternalGroupsForProvider.mockResolvedValue([
        { id: "g1", name: "Group 1", members: [{ email: "shared@example.com", active: true, display_name: "Shared User" }] },
        { id: "g2", name: "Group 2", members: [{ email: "shared@example.com", active: true, display_name: "Shared User" }] },
      ]);
      provisionShellUser.mockResolvedValue({ sub: "cached-sub", created: false });

      const groups = await (async () => {
        // Capture the groups array passed into the planner, which the runner
        // mutates in place to stamp resolved `subject` values.
        let captured: unknown;
        planIdentityGroupSync.mockImplementation((input: { groups: unknown }) => {
          captured = input.groups;
          return { matched_groups: [] };
        });
        await executeSyncRun("run-1", "okta", "admin");
        return captured as Array<{ members: Array<{ subject?: string }> }>;
      })();

      expect(provisionShellUser).toHaveBeenCalledTimes(1);
      expect(groups[0].members[0].subject).toBe("cached-sub");
      expect(groups[1].members[0].subject).toBe("cached-sub");
    });

    it("skips inactive members and members with no email", async () => {
      fetchExternalGroupsForProvider.mockResolvedValue([
        {
          id: "g1",
          name: "Group 1",
          members: [
            { email: "inactive@example.com", active: false, display_name: "Inactive User" },
            { active: true, display_name: "No Email" },
          ],
        },
      ]);

      await executeSyncRun("run-1", "okta", "admin");

      expect(provisionShellUser).not.toHaveBeenCalled();
    });

    it("logs and continues when provisioning a member fails, leaving its subject unresolved", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      fetchExternalGroupsForProvider.mockResolvedValue([
        { id: "g1", name: "Group 1", members: [{ email: "fails@example.com", active: true, display_name: "Fails User" }] },
      ]);
      provisionShellUser.mockRejectedValue(new Error("keycloak unreachable"));

      let captured: unknown;
      planIdentityGroupSync.mockImplementation((input: { groups: unknown }) => {
        captured = input.groups;
        return { matched_groups: [] };
      });

      await executeSyncRun("run-1", "okta", "admin");

      const groups = captured as Array<{ members: Array<{ subject?: string }> }>;
      expect(groups[0].members[0].subject).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("fails@example.com: keycloak unreachable"));
      // The run itself must still complete successfully — one bad Okta member
      // must not fail the whole sync.
      expect(updateIdpSyncRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "success" }));

      warnSpy.mockRestore();
    });
  });

  describe("executeSyncRun: Okta federated-identity linking", () => {
    it("links each resolved Okta member once via linkFederatedIdentity", async () => {
      fetchExternalGroupsForProvider.mockResolvedValue([
        {
          id: "g1",
          name: "Group 1",
          members: [{ email: "jane@example.com", active: true, display_name: "Jane Doe", okta_user_id: "okta-1" }],
        },
      ]);

      await executeSyncRun("run-1", "okta", "admin");

      expect(linkFederatedIdentity).toHaveBeenCalledWith("sub-1", "okta", {
        userId: "okta-1",
        userName: "jane@example.com",
      });
    });

    it("does not warn when linkFederatedIdentity resolves normally (e.g. after a 409 already-linked no-op)", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      fetchExternalGroupsForProvider.mockResolvedValue([
        {
          id: "g1",
          name: "Group 1",
          members: [{ email: "jane@example.com", active: true, display_name: "Jane Doe", okta_user_id: "okta-1" }],
        },
      ]);
      linkFederatedIdentity.mockResolvedValue(undefined);

      await executeSyncRun("run-1", "okta", "admin");

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("failed to link federated identity"));
      warnSpy.mockRestore();
    });

    it("logs and continues when linkFederatedIdentity fails for a real (non-409) reason", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      fetchExternalGroupsForProvider.mockResolvedValue([
        {
          id: "g1",
          name: "Group 1",
          members: [{ email: "jane@example.com", active: true, display_name: "Jane Doe", okta_user_id: "okta-1" }],
        },
      ]);
      linkFederatedIdentity.mockRejectedValue(new Error("linkFederatedIdentity failed: 500"));

      await executeSyncRun("run-1", "okta", "admin");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed to link federated identity for jane@example.com")
      );
      expect(updateIdpSyncRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "success" }));
      warnSpy.mockRestore();
    });
  });

  describe("executeSyncRun: event-loop yield cadence", () => {
    it("yields to the event loop every 50 processed members so /api/health can interleave", async () => {
      const members = Array.from({ length: 120 }, (_, i) => ({
        email: `user${i}@example.com`,
        active: true,
        display_name: `User ${i}`,
      }));
      fetchExternalGroupsForProvider.mockResolvedValue([{ id: "g1", name: "Group 1", members }]);

      const setImmediateSpy = jest.spyOn(global, "setImmediate");

      await executeSyncRun("run-1", "okta", "admin");

      // 120 members with MEMBERS_PER_YIELD=50 yields at the 50th and 100th member.
      expect(setImmediateSpy).toHaveBeenCalledTimes(2);
      setImmediateSpy.mockRestore();
    });

    it("never yields for a run with fewer members than the yield threshold", async () => {
      const members = Array.from({ length: 10 }, (_, i) => ({
        email: `user${i}@example.com`,
        active: true,
        display_name: `User ${i}`,
      }));
      fetchExternalGroupsForProvider.mockResolvedValue([{ id: "g1", name: "Group 1", members }]);

      const setImmediateSpy = jest.spyOn(global, "setImmediate");

      await executeSyncRun("run-1", "okta", "admin");

      expect(setImmediateSpy).not.toHaveBeenCalled();
      setImmediateSpy.mockRestore();
    });
  });

  describe("executeSyncRun: plan/apply wiring and run outcome", () => {
    it("builds the plan from fetched groups and records success with the reconciler's counts", async () => {
      fetchExternalGroupsForProvider.mockResolvedValue([{ id: "g1", name: "Group 1", members: [] }]);
      planIdentityGroupSync.mockReturnValue({ matched_groups: [{ groupId: "g1" }] });
      applyIdentityGroupSyncPlan.mockResolvedValue({
        teamsCreated: 1,
        membershipSourcesAdded: 3,
        membershipSourcesRemoved: 1,
        membershipSourcesRefreshed: 2,
        tupleWrites: 4,
        tupleDeletes: 1,
        openFgaEnabled: true,
        teamsArchived: 0,
      });

      await executeSyncRun("run-1", "okta", "admin");

      expect(applyIdentityGroupSyncPlan).toHaveBeenCalledWith(
        expect.objectContaining({ plan: { matched_groups: [{ groupId: "g1" }] }, actor: "admin" })
      );
      expect(updateIdpSyncRun).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          status: "success",
          groups_fetched: 1,
          groups_matched: 1,
          membership_sources_added: 3,
          membership_sources_removed: 1,
        })
      );
    });

    it("records a failed run with the error message when a dependency throws", async () => {
      fetchExternalGroupsForProvider.mockRejectedValue(new Error("Okta 429"));
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      await expect(executeSyncRun("run-1", "okta", "admin")).resolves.toBeUndefined();

      expect(updateIdpSyncRun).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({ status: "failed", error_message: "Okta 429" })
      );
      expect(planIdentityGroupSync).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });
});
