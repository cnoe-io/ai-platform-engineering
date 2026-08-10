export const MAX_TEAM_SLUG_LENGTH = 63;

export interface TeamSlugCandidate {
  id?: string;
  _id?: string;
  slug?: string;
  name?: string;
}

export function normalizeTeamSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TEAM_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

export function isValidNormalizedTeamSlug(slug: string): boolean {
  if (!slug || slug.length > MAX_TEAM_SLUG_LENGTH) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

function teamId(team: TeamSlugCandidate): string | undefined {
  return team.id ?? team._id;
}

export function findTeamSlugCollision<T extends TeamSlugCandidate>(
  slug: string,
  existingTeams: readonly T[],
  currentTeamId?: string
): T | null {
  const normalizedSlug = normalizeTeamSlug(slug);
  if (!normalizedSlug) return null;

  return (
    existingTeams.find((team) => {
      if (teamId(team) && teamId(team) === currentTeamId) return false;
      return normalizeTeamSlug(team.slug ?? "") === normalizedSlug;
    }) ?? null
  );
}
