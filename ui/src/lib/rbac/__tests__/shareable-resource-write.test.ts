/**
 * Tests for `handleShareableResourceWrite` — the route-orchestration helper
 * (spec 2026-06-03-unified-shareable-resource-rbac, US1 contract R2).
 *
 * Reconciliation is disabled in the test env (no OPENFGA_HTTP), so
 * `reconcileShareableResource` is an inert `{ enabled: false }` no-op. These
 * tests pin the orchestration logic: creator set-once, owner immutability
 * outside transfer, owner-team membership validation, previous-set read from
 * config, and the persisted next state.
 */

import { handleShareableResourceWrite } from "@/lib/rbac/shareable-resource";
import { ApiError } from "@/lib/api-error";

const session = { sub: "creator-1" } as const;

function ctxBase(overrides: Record<string, unknown> = {}) {
  return {
    objectType: "data_source",
    objectId: "ds-1",
    session,
    canUseOwnerTeam: async () => true,
    persist: async () => {},
    loadPrevious: async () => ({
      ownerTeamSlug: null,
      sharedTeamSlugs: [],
      creatorSubject: null,
    }),
    ...overrides,
  };
}

describe("handleShareableResourceWrite", () => {
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

  it("rejects an owner change when allowOwnerTransfer is false", async () => {
    await expect(
      handleShareableResourceWrite(
        ctxBase({
          requestedOwnerTeamSlug: "new-team",
          loadPrevious: async () => ({
            ownerTeamSlug: "old-team",
            sharedTeamSlugs: [],
            creatorSubject: "c",
          }),
        }) as never,
      ),
    ).rejects.toThrow(ApiError);
  });

  it("allows an owner change when allowOwnerTransfer is true", async () => {
    const result = await handleShareableResourceWrite(
      ctxBase({
        allowOwnerTransfer: true,
        requestedOwnerTeamSlug: "new-team",
        canUseOwnerTeam: async () => true,
        loadPrevious: async () => ({
          ownerTeamSlug: "old-team",
          sharedTeamSlugs: [],
          creatorSubject: "c",
        }),
      }) as never,
    );
    expect(result.ownerTeamSlug).toBe("new-team");
  });

  it("rejects when the caller cannot use the requested owner team", async () => {
    await expect(
      handleShareableResourceWrite(
        ctxBase({
          requestedOwnerTeamSlug: "platform",
          canUseOwnerTeam: async () => false,
        }) as never,
      ),
    ).rejects.toMatchObject({ code: "OWNER_TEAM_FORBIDDEN" });
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
    // owner (platform) deduped out of shared; data-eng kept.
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
