export interface BuiltInOAuthConnectorDescriptor {
  provider: "github" | "atlassian" | "webex";
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
    scopes: ["repo", "read:user", "offline_access"],
  },
  {
    provider: "atlassian",
    name: "Atlassian Cloud",
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["offline_access", "read:jira-work", "read:confluence-content.all"],
  },
  {
    provider: "webex",
    name: "Webex",
    authorizationUrl: "https://webexapis.com/v1/authorize",
    tokenUrl: "https://webexapis.com/v1/access_token",
    scopes: ["spark:all", "offline_access"],
  },
];
