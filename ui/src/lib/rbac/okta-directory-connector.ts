import type { ExternalGroup } from "@/types/identity-group-sync";

interface OktaGroup {
  id: string;
  profile?: {
    name?: string;
    description?: string;
  };
  lastUpdated?: string;
}

interface OktaUser {
  id: string;
  status?: string;
  profile?: {
    email?: string;
    login?: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
  };
}

export type OktaExternalGroup = ExternalGroup & {
  members: Array<{
    subject?: string;
    email: string;
    display_name?: string;
    active: boolean;
  }>;
};

function oktaConfig(): { orgUrl: string; apiToken: string } {
  const orgUrl = process.env.IDENTITY_SYNC_OKTA_ORG_URL?.replace(/\/+$/, "");
  const apiToken = process.env.IDENTITY_SYNC_OKTA_API_TOKEN;
  if (!orgUrl || !apiToken) {
    throw new Error("Okta directory connector is not configured");
  }
  return { orgUrl, apiToken };
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  const links = header.split(",").map((part) => part.trim());
  for (const link of links) {
    const match = link.match(/^<([^>]+)>;\s*rel="next"$/);
    if (match) return match[1];
  }
  return null;
}

async function fetchOktaPage<T>(url: string, apiToken: string): Promise<{ items: T[]; next: string | null }> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `SSWS ${apiToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Okta directory request failed with status ${response.status}`);
  }
  return {
    items: (await response.json()) as T[],
    next: nextLink(response.headers.get("link")),
  };
}

async function fetchAllOktaPages<T>(firstUrl: string, apiToken: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const page = await fetchOktaPage<T>(url, apiToken);
    items.push(...page.items);
    url = page.next;
  }
  return items;
}

function oktaUserDisplayName(user: OktaUser): string | undefined {
  if (user.profile?.displayName) return user.profile.displayName;
  const fullName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ").trim();
  return fullName || user.profile?.email || user.profile?.login;
}

export async function fetchOktaExternalGroups(input: { providerId: string }): Promise<OktaExternalGroup[]> {
  const { orgUrl, apiToken } = oktaConfig();
  const groups = await fetchAllOktaPages<OktaGroup>(`${orgUrl}/api/v1/groups?limit=200`, apiToken);
  const externalGroups: OktaExternalGroup[] = [];

  for (const group of groups) {
    const displayName = group.profile?.name ?? group.id;
    const users = await fetchAllOktaPages<OktaUser>(
      `${orgUrl}/api/v1/groups/${encodeURIComponent(group.id)}/users?limit=200`,
      apiToken
    );

    externalGroups.push({
      provider_id: input.providerId,
      external_group_id: group.id,
      display_name: displayName,
      normalized_name: displayName.toLowerCase(),
      status: "active",
      member_count: users.length,
      last_seen_at: new Date().toISOString(),
      metadata: {
        description: group.profile?.description ?? "",
        lastUpdated: group.lastUpdated ?? "",
      },
      members: users
        .map((user) => ({
          subject: undefined,
          email: user.profile?.email ?? user.profile?.login ?? user.id,
          display_name: oktaUserDisplayName(user),
          active: user.status !== "DEPROVISIONED" && user.status !== "SUSPENDED",
        }))
        .filter((member) => Boolean(member.email)),
    });
  }

  return externalGroups;
}
