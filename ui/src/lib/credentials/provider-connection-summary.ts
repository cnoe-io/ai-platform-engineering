// assisted-by Codex Codex-sonnet-4-6

export function buildProviderProfileSummary(
  provider: string,
  profile?: Record<string, unknown>,
  accessibleResources?: Array<Record<string, unknown>>,
): string | undefined {
  switch (provider) {
    case "github": {
      const login = typeof profile?.login === "string" ? profile.login.trim() : "";
      return login ? `@${login}` : undefined;
    }
    case "gitlab": {
      const username = typeof profile?.username === "string" ? profile.username.trim() : "";
      return username ? `@${username}` : undefined;
    }
    case "atlassian": {
      const siteNames =
        accessibleResources
          ?.map((resource) => resource.name)
          .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
          .slice(0, 2) ?? [];
      if (siteNames.length > 0) {
        return siteNames.join(", ");
      }
      const email = typeof profile?.email === "string" ? profile.email.trim() : "";
      if (email) return email;
      const name = typeof profile?.name === "string" ? profile.name.trim() : "";
      return name || undefined;
    }
    case "webex":
    case "webex_pam": {
      const displayName =
        typeof profile?.displayName === "string" ? profile.displayName.trim() : "";
      if (displayName) return displayName;
      const emails = profile?.emails;
      if (Array.isArray(emails) && typeof emails[0] === "string" && emails[0].trim()) {
        return emails[0].trim();
      }
      const userName = typeof profile?.userName === "string" ? profile.userName.trim() : "";
      return userName || undefined;
    }
    case "pagerduty": {
      const name = typeof profile?.name === "string" ? profile.name.trim() : "";
      const email = typeof profile?.email === "string" ? profile.email.trim() : "";
      return name || email || undefined;
    }
    default:
      return undefined;
  }
}
