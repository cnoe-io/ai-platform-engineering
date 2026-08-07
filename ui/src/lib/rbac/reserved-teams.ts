/** Teams with platform-defined mutation rules. */
export const EVERYONE_TEAM_SLUG = "everyone";

export function isEveryoneTeamSlug(slug: string | null | undefined): boolean {
  return slug?.trim().toLowerCase() === EVERYONE_TEAM_SLUG;
}
