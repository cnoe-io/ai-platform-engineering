import {
  findTeamSlugCollision,
  isValidNormalizedTeamSlug,
  normalizeTeamSlug,
} from "../../team-slugs";

describe("identity group team slug helpers", () => {
  it("normalizes display names into deterministic team slugs", () => {
    expect(normalizeTeamSlug("CAIPE Platform Engineering Members")).toBe(
      "caipe-platform-engineering-members"
    );
    expect(normalizeTeamSlug("  Platform___Engineering / Admins  ")).toBe(
      "platform-engineering-admins"
    );
  });

  it("keeps generated slugs within the Keycloak-safe team slug limit", () => {
    const slug = normalizeTeamSlug(
      "CAIPE Platform Engineering Reliability Automation Observability Members"
    );

    expect(slug).toHaveLength(63);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidNormalizedTeamSlug(slug)).toBe(true);
  });

  it("rejects empty and structurally invalid slugs", () => {
    expect(normalizeTeamSlug("!!!")).toBe("");
    expect(isValidNormalizedTeamSlug("")).toBe(false);
    expect(isValidNormalizedTeamSlug("-team")).toBe(false);
    expect(isValidNormalizedTeamSlug("team-")).toBe(false);
    expect(isValidNormalizedTeamSlug("Team")).toBe(false);
  });

  it("finds slug collisions while allowing the current team to keep its slug", () => {
    const existingTeams = [
      { id: "team-1", slug: "platform-engineering", name: "Platform Engineering" },
      { id: "team-2", slug: "sre", name: "SRE" },
    ];

    expect(findTeamSlugCollision("platform-engineering", existingTeams, "team-1")).toBeNull();
    expect(findTeamSlugCollision("platform-engineering", existingTeams, "team-3")).toEqual(
      existingTeams[0]
    );
  });
});
