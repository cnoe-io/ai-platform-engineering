/**
 * Tests for `handleShareableResourceWrite` — the unified route-orchestration
 * helper (spec 2026-06-03, US1 contract R2; transfer convergence 2026-06).
 *
 * The helper owns the ownership flow every shareable type shares: creator
 * set-once, first-set membership check, TRANSFER (guarded by
 * canTransferResourceOwnership + not-a-member confirm + previous-owner revoke),
 * shared-team + org-scope diff, reconcile, and persist. We inject a fake
 * `reconcile` so these tests assert orchestration without touching OpenFGA, and
 * mock the transfer guard + membership checks.
 */

const mockCanTransferResourceOwnership = jest.fn();
jest.mock("@/lib/rbac/resource-authz", () => ({
  canTransferResourceOwnership: (...args: unknown[]) =>
    mockCanTransferResourceOwnership(...args),
  requireResourcePermission: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileShareableResource: jest.fn().mockResolvedValue({ enabled: true, writes: 0, deletes: 0 }),
}));

import { handleShareableResourceWrite } from "@/lib/rbac/shareable-resource";

const session = { sub: "creator-1" } as const;
const noopReconcile = jest.fn().mockResolvedValue({ enabled: false, writes: 0, deletes: 0 });

beforeEach(() => {
  jest.clearAllMocks();
  mockCanTransferResourceOwnership.mockResolvedValue(true);
  noopReconcile.mockResolvedValue({ enabled: false, writes: 0, deletes: 0 });
});

function ctxBase(overrides: Record<string, unknown> = {}) {
  return {
    objectType: "data_source",
    objectId: "ds-1",
    session,
    canUseOwnerTeam: async () => true,
    persist: async () => {},
    reconcile: noopReconcile,
    loadPrevious: async () => ({
      ownerTeamSlug: null,
      sharedTeamSlugs: [],
      creatorSubject: null,
    }),
    ...overrides,
  };
}

describe("handleShareableResourceWrite — creator & shared", () => {
  it("stamps the creator from the session on first write", async () => {
    let persisted: { creatorSubject: string | null } | null = null;
    const result = await handleShareableResourceWrite(
      ctxBase({
        requestedOwnerTeamSlug: "platform",
        persist: async (next: { creatorSubject: string | null }) => {
          persisted = next;
        },
      }) as never,
    );
    expect(result.creatorSubject).toBe("creator-1");
    expect(persisted!.creatorSubject).toBe("creator-1");
  });

  it("keeps the existing creator on a later write (set-once)", async () => {
    const result = await handleShareableResourceWrite(
      ctxBase({
        requestedSharedTeamSlugs: ["data-eng"],
        loadPrevious: async () => ({
          ownerTeamSlug: "platform",
          sharedTeamSlugs: [],
          creatorSubject: "original-creator",
        }),
      }) as never,
    );
    expect(result.creatorSubject).toBe("original-creator");
  });

  it("reads the previous shared set from config and dedupes the owner out of next", async () => {
    let persisted: { sharedTeamSlugs: string[] } | null = null;
    const result = await handleShareableResourceWrite(
      ctxBase({
        requestedOwnerTeamSlug: "platform",
        requestedSharedTeamSlugs: ["platform", "data-eng"],
        loadPrevious: async () => ({
          ownerTeamSlug: "platform",
          sharedTeamSlugs: ["legacy"],
          creatorSubject: "c",
        }),
        persist: async (next: { sharedTeamSlugs: string[] }) => {
          persisted = next;
        },
      }) as never,
    );
    expect(result.sharedTeamSlugs).toEqual(["data-eng"]);
    expect(persisted!.sharedTeamSlugs).toEqual(["data-eng"]);
  });

  it("keeps the previous shared set when none is requested", async () => {
    const result = await handleShareableResourceWrite(
      ctxBase({
        requestedOwnerTeamSlug: "platform",
        requestedSharedTeamSlugs: null,
        loadPrevious: async () => ({
          ownerTeamSlug: "platform",
          sharedTeamSlugs: ["data-eng"],
          creatorSubject: "c",
        }),
      }) as never,
    );
    expect(result.sharedTeamSlugs).toEqual(["data-eng"]);
  });
});

describe("handleShareableResourceWrite — first-set membership", () => {
  it("rejects when the caller cannot use the requested owner team on first-set", async () => {
    await expect(
      handleShareableResourceWrite(
        ctxBase({
          requestedOwnerTeamSlug: "platform",
          canUseOwnerTeam: async () => false,
        }) as never,
      ),
    ).rejects.toMatchObject({ code: "OWNER_TEAM_FORBIDDEN" });
  });
});

describe("handleShareableResourceWrite — transfer", () => {
  const transferCtx = (overrides: Record<string, unknown> = {}) =>
    ctxBase({
      requestedOwnerTeamSlug: "new-team",
      loadPrevious: async () => ({
        ownerTeamSlug: "old-team",
        sharedTeamSlugs: [],
        creatorSubject: "c",
      }),
      ...overrides,
    });

  it("denies a transfer when the caller is neither owner-team admin nor org admin", async () => {
    mockCanTransferResourceOwnership.mockResolvedValue(false);
    await expect(
      handleShareableResourceWrite(transferCtx() as never),
    ).rejects.toMatchObject({ code: "TRANSFER_FORBIDDEN" });
  });

  it("requires not-a-member confirmation when transferring to a team the caller isn't in", async () => {
    mockCanTransferResourceOwnership.mockResolvedValue(true);
    await expect(
      handleShareableResourceWrite(
        transferCtx({ canUseOwnerTeam: async () => false }) as never,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_MEMBER_UNCONFIRMED" });
  });

  it("completes a not-a-member transfer once confirmed, revoking the old owner", async () => {
    mockCanTransferResourceOwnership.mockResolvedValue(true);
    const result = await handleShareableResourceWrite(
      transferCtx({
        canUseOwnerTeam: async () => false,
        confirmedNotMember: true,
      }) as never,
    );
    expect(result.ownerTeamSlug).toBe("new-team");
    expect(result.transferred).toBe(true);
    // The reconcile must carry previousOwnerTeamSlug so the old team is revoked.
    expect(noopReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerTeamSlug: "new-team",
        previousOwnerTeamSlug: "old-team",
        creatorSubject: "c",
      }),
    );
  });

  it("completes a transfer to a team the caller IS in without confirmation", async () => {
    mockCanTransferResourceOwnership.mockResolvedValue(true);
    const result = await handleShareableResourceWrite(
      transferCtx({ canUseOwnerTeam: async () => true }) as never,
    );
    expect(result.transferred).toBe(true);
    expect(result.ownerTeamSlug).toBe("new-team");
  });

  it("does not treat a no-op owner write as a transfer", async () => {
    const result = await handleShareableResourceWrite(
      ctxBase({
        requestedOwnerTeamSlug: "platform",
        loadPrevious: async () => ({
          ownerTeamSlug: "platform",
          sharedTeamSlugs: [],
          creatorSubject: "c",
        }),
      }) as never,
    );
    expect(result.transferred).toBe(false);
    expect(mockCanTransferResourceOwnership).not.toHaveBeenCalled();
    // previousOwnerTeamSlug must be undefined (no revoke) on a no-op.
    expect(noopReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ previousOwnerTeamSlug: undefined }),
    );
  });
});

describe("handleShareableResourceWrite — org-wide sharing", () => {
  it("passes org scope through and keeps previous when omitted", async () => {
    await handleShareableResourceWrite(
      ctxBase({
        requestedOwnerTeamSlug: "platform",
        requestedSharedWithOrg: true,
        loadPrevious: async () => ({
          ownerTeamSlug: "platform",
          sharedTeamSlugs: [],
          creatorSubject: "c",
          sharedWithOrg: false,
        }),
      }) as never,
    );
    expect(noopReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ sharedWithOrg: true, previousSharedWithOrg: false }),
    );
  });

  it("keeps previous org scope when the request omits it", async () => {
    const result = await handleShareableResourceWrite(
      ctxBase({
        requestedSharedWithOrg: null,
        loadPrevious: async () => ({
          ownerTeamSlug: "platform",
          sharedTeamSlugs: [],
          creatorSubject: "c",
          sharedWithOrg: true,
        }),
      }) as never,
    );
    expect(result.sharedWithOrg).toBe(true);
  });
});
