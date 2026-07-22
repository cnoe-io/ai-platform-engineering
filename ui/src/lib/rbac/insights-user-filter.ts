import { loadTeamMembersForSlugs } from './team-membership-store';

export interface InsightsUserFilter {
  active: boolean;
  emails: string[];
  teamSlugs: string[];
}

function parseFilterValues(value: string | null): string[] {
  return [...new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

/**
 * Resolve the user/team filter into the owner emails stored on Insights data.
 *
 * This is a query filter, not an authorization decision. Callers must apply the
 * returned emails in addition to their existing server-side visibility scope.
 * `active` stays true when a selected team has no resolvable members so callers
 * can fail closed with `$in: []` instead of accidentally returning all users.
 */
export async function resolveInsightsUserFilter(
  userFilter: string | null,
  teamFilter: string | null,
): Promise<InsightsUserFilter> {
  const directUsers = parseFilterValues(userFilter);
  const teamSlugs = parseFilterValues(teamFilter);
  const emails = new Map<string, string>();

  const addEmail = (value: string | undefined): void => {
    const email = value?.trim();
    if (!email) return;
    const normalized = email.toLowerCase();
    if (!emails.has(normalized)) emails.set(normalized, email);
  };

  directUsers.forEach(addEmail);
  if (teamSlugs.length > 0) {
    const membersByTeam = await loadTeamMembersForSlugs(teamSlugs);
    for (const members of membersByTeam.values()) {
      for (const member of members) addEmail(member.user_email);
    }
  }

  return {
    active: directUsers.length > 0 || teamSlugs.length > 0,
    emails: [...emails.values()],
    teamSlugs,
  };
}
