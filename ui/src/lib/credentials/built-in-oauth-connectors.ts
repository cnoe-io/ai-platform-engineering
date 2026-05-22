export interface BuiltInOAuthConnectorDescriptor {
  provider: "github" | "atlassian" | "webex" | "pagerduty" | "gitlab";
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export const BUILT_IN_OAUTH_CONNECTORS: BuiltInOAuthConnectorDescriptor[] = [
  {
    provider: "github",
    name: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user"],
  },
  {
    provider: "atlassian",
    name: "Atlassian Cloud",
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["offline_access", "read:me", "read:jira-work", "read:confluence-content.all"],
  },
  {
    provider: "webex",
    name: "Webex",
    authorizationUrl: "https://webexapis.com/v1/authorize",
    tokenUrl: "https://webexapis.com/v1/access_token",
    scopes: [
      "spark:kms",
      "spark:people_read",
      "meeting:recordings_read",
      "identity:people_read",
      "spark:messages_read",
      "spark:mcp",
      "spark-admin:people_read",
    ],
  },
  {
    provider: "pagerduty",
    name: "PagerDuty",
    authorizationUrl: "https://identity.pagerduty.com/oauth/authorize",
    tokenUrl: "https://identity.pagerduty.com/oauth/token",
    scopes: [
      "users.read",
      "incidents.read",
      "services.read",
      "oncalls.read",
      "schedules.read",
      "teams.read",
      "escalation_policies.read",
    ],
  },
  {
    provider: "gitlab",
    name: "GitLab",
    authorizationUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    scopes: ["api", "read_user"],
  },
];
