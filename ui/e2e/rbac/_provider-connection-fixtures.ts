// assisted-by Codex Codex-sonnet-4-6

import { DEFAULT_OAUTH_CONNECTOR } from "./_credentials-browser-fixtures";

export type ProviderConnectionFixture = {
  id: string;
  connectorId?: string;
  provider: string;
  status: string;
  updatedAt?: string;
  connectedAt?: string;
  expiresAt?: string;
  profileSummary?: string;
  profileCheckedAt?: string;
  grantedScopes?: string[];
  requestedScopes?: string[];
  owner?: {
    email?: string;
    name?: string;
    displayName?: string;
  };
};

const ONE_HOUR_MS = 60 * 60 * 1000;

export const NEW_ATLASSIAN_CONNECTION: ProviderConnectionFixture = {
  id: "conn-atlassian-new",
  connectorId: DEFAULT_OAUTH_CONNECTOR.id,
  provider: "atlassian",
  status: "connected",
  connectedAt: "2026-06-21T04:44:00.000Z",
  updatedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
  profileSummary: "cisco-eti",
  grantedScopes: ["offline_access", "read:me", "read:jira-work", "read:jira-user"],
  owner: {
    email: "sraradhy@cisco.com",
    name: "Platform Admin",
  },
};

export const OLD_ATLASSIAN_CONNECTION: ProviderConnectionFixture = {
  id: "conn-atlassian-old",
  connectorId: DEFAULT_OAUTH_CONNECTOR.id,
  provider: "atlassian",
  status: "connected",
  connectedAt: "2026-06-01T04:44:00.000Z",
  updatedAt: "2026-06-01T04:44:00.000Z",
  expiresAt: new Date(Date.now() - 60_000).toISOString(),
  profileSummary: "legacy-site",
  grantedScopes: ["offline_access", "read:me", "read:jira-work"],
  owner: {
    email: "sraradhy@cisco.com",
    name: "Platform Admin",
  },
};

export const EXPIRED_ATLASSIAN_CONNECTION: ProviderConnectionFixture = {
  ...OLD_ATLASSIAN_CONNECTION,
  id: "conn-atlassian-expired",
  status: "connected",
  updatedAt: new Date(Date.now() - 31 * 24 * ONE_HOUR_MS).toISOString(),
  expiresAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  profileSummary: "cisco-eti",
};

export const GITHUB_PROVIDER_CONNECTION: ProviderConnectionFixture = {
  id: "conn-github",
  connectorId: "github-connector",
  provider: "github",
  status: "connected",
  updatedAt: new Date(Date.now() - 2 * ONE_HOUR_MS).toISOString(),
  profileSummary: "@octocat",
  owner: {
    email: "owner@caipe.local",
    name: "Workspace Owner",
  },
};

export const ATLASSIAN_OPTION_LABEL =
  "Atlassian Cloud · healthy · refreshed 30m ago · cisco-eti";

export const ATLASSIAN_OPTION_LABEL_NO_PROFILE =
  "Atlassian Cloud · healthy · refreshed 30m ago · sraradhy@cisco.com";

export const EXPIRED_OPTION_LABEL_PATTERN = /Atlassian Cloud · expired · refreshed \d+d ago · cisco-eti/;
