import { describe, expect, it, jest } from "@jest/globals";

import { buildOAuthConnectorBootstrapInputs, bootstrapOAuthConnectorsFromEnv } from "../oauth-bootstrap";
import type { CreateConnectorInput, OAuthConnectorMetadata, OAuthConnectorService } from "../oauth-service";

type UpsertConnector = OAuthConnectorService["upsertConnector"];

function connectorMetadata(input: Partial<CreateConnectorInput> & { id?: string } = {}): OAuthConnectorMetadata {
  return {
    id: input.id ?? "connector-1",
    name: input.name ?? "GitHub",
    provider: input.provider ?? "github",
    clientId: input.clientId ?? "github-client",
    authorizationUrl: input.authorizationUrl ?? "https://github.com/login/oauth/authorize",
    tokenUrl: input.tokenUrl ?? "https://github.com/login/oauth/access_token",
    scopes: input.scopes ?? ["repo", "read:user"],
    redirectUri: input.redirectUri ?? "https://caipe.example.com/api/credentials/oauth/github/callback",
    enabled: true,
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
    updatedAt: new Date("2026-05-21T00:00:00.000Z"),
    clientSecretConfigured: true,
  };
}

describe("OAuth connector env bootstrap", () => {
  it("builds provider connector inputs from env without exposing secret values", () => {
    const inputs = buildOAuthConnectorBootstrapInputs({
      GITHUB_CLIENT_ID: "github-client",
      GITHUB_CLIENT_SECRET: "github-secret",
      GITHUB_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/github/callback",
      CONFLUENCE_CLIENT_ID: "atlassian-client",
      CONFLUENCE_CLIENT_SECRET: "atlassian-secret",
      CONFLUENCE_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/atlassian/callback",
      WEBEX_CLIENT_ID: "webex-client",
      WEBEX_CLIENT_SECRET: "webex-secret",
      WEBEX_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/webex/callback",
      PAGERDUTY_CLIENT_ID: "pagerduty-client",
      PAGERDUTY_CLIENT_SECRET: "pagerduty-secret",
      PAGERDUTY_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/pagerduty/callback",
      PAGERDUTY_SCOPES: "users.read incidents.read",
      GITLAB_CLIENT_ID: "gitlab-client",
      GITLAB_CLIENT_SECRET: "gitlab-secret",
      GITLAB_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/gitlab/callback",
    });

    expect(inputs.map((input) => input.provider)).toEqual(["github", "atlassian", "webex", "pagerduty", "gitlab"]);
    expect(inputs[0].scopes).toEqual(["repo", "read:user"]);
    expect(inputs[0].scopes).not.toContain("offline_access");
    expect(inputs[1]).toMatchObject({
      name: "Atlassian Cloud",
      clientId: "atlassian-client",
      clientSecret: "atlassian-secret",
    });
    expect(inputs[1].scopes).toContain("read:me");
    expect(inputs[1].scopes).toEqual(
      expect.arrayContaining([
        "read:jira-user",
        "write:jira-work",
        "write:confluence-content",
      ]),
    );
    expect(inputs[2]).toMatchObject({
      name: "Webex",
      clientId: "webex-client",
      clientSecret: "webex-secret",
      scopes: [
        "spark:mcp",
        "meeting:schedules_read",
        "meeting:schedules_write",
        "meeting:participants_read",
        "meeting:transcripts_read",
        "meeting:summaries_read",
        "meeting:recordings_read",
        "spark:people_read",
        "spark:rooms_read",
        "spark:messages_read",
        "identity:people_read",
        "spark:kms",
        "spark-admin:people_read",
      ],
    });
    expect(inputs[3]).toMatchObject({
      name: "PagerDuty",
      clientId: "pagerduty-client",
      clientSecret: "pagerduty-secret",
      scopes: ["users.read", "incidents.read"],
    });
    expect(inputs[4]).toMatchObject({
      name: "GitLab",
      clientId: "gitlab-client",
      clientSecret: "gitlab-secret",
      authorizationUrl: "https://gitlab.com/oauth/authorize",
      tokenUrl: "https://gitlab.com/oauth/token",
      scopes: ["api", "read_user"],
    });
    expect(JSON.stringify(inputs)).not.toContain("oauth_connector:");
  });

  it("uses read-only PagerDuty scopes when PAGERDUTY_SCOPES is not set", () => {
    const inputs = buildOAuthConnectorBootstrapInputs({
      PAGERDUTY_CLIENT_ID: "pagerduty-client",
      PAGERDUTY_CLIENT_SECRET: "pagerduty-secret",
      PAGERDUTY_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/pagerduty/callback",
    });

    expect(inputs).toEqual([
      expect.objectContaining({
        provider: "pagerduty",
        scopes: expect.arrayContaining([
          "users.read",
          "incidents.read",
          "services.read",
          "oncalls.read",
          "schedules.read",
          "teams.read",
          "escalation_policies.read",
        ]),
      }),
    ]);
  });

  it("uses GitLab.com defaults and allows overriding GitLab scopes", () => {
    const defaults = buildOAuthConnectorBootstrapInputs({
      GITLAB_CLIENT_ID: "gitlab-client",
      GITLAB_CLIENT_SECRET: "gitlab-secret",
      GITLAB_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/gitlab/callback",
    });
    const overridden = buildOAuthConnectorBootstrapInputs({
      GITLAB_CLIENT_ID: "gitlab-client",
      GITLAB_CLIENT_SECRET: "gitlab-secret",
      GITLAB_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/gitlab/callback",
      GITLAB_SCOPES: "read_user read_api",
    });

    expect(defaults).toEqual([
      expect.objectContaining({
        provider: "gitlab",
        authorizationUrl: "https://gitlab.com/oauth/authorize",
        tokenUrl: "https://gitlab.com/oauth/token",
        scopes: ["api", "read_user"],
      }),
    ]);
    expect(overridden).toEqual([
      expect.objectContaining({
        provider: "gitlab",
        scopes: ["read_user", "read_api"],
      }),
    ]);
  });

  it("allows Webex scopes to be overridden by the legacy deployment env name", () => {
    const inputs = buildOAuthConnectorBootstrapInputs({
      WEBEX_CLIENT_ID: "webex-client",
      WEBEX_CLIENT_SECRET: "webex-secret",
      WEBEX_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/webex/callback",
      WEBEX_OAUTH_SCOPES: "spark:mcp meeting:schedules_read meeting:transcripts_read",
    });

    expect(inputs).toEqual([
      expect.objectContaining({
        provider: "webex",
        scopes: ["spark:mcp", "meeting:schedules_read", "meeting:transcripts_read"],
      }),
    ]);
  });

  it("normalizes legacy local GitHub and Webex callback URLs to the CAIPE UI callback route", () => {
    const inputs = buildOAuthConnectorBootstrapInputs({
      NEXTAUTH_URL: "http://localhost:3000",
      GITHUB_CLIENT_ID: "github-client",
      GITHUB_CLIENT_SECRET: "github-secret",
      GITHUB_REDIRECT_URI: "http://localhost:3001/oauth/github/callback",
      WEBEX_CLIENT_ID: "webex-client",
      WEBEX_CLIENT_SECRET: "webex-secret",
      WEBEX_REDIRECT_URI: "http://localhost:3001/oauth/webex/callback",
    });

    expect(inputs).toEqual([
      expect.objectContaining({
        provider: "github",
        redirectUri: "http://localhost:3000/api/credentials/oauth/github/callback",
      }),
      expect.objectContaining({
        provider: "webex",
        redirectUri: "http://localhost:3000/api/credentials/oauth/webex/callback",
      }),
    ]);
  });

  it("normalizes legacy Webex Settings callback URLs to the Connected Apps callback route", () => {
    const inputs = buildOAuthConnectorBootstrapInputs({
      WEBEX_CLIENT_ID: "webex-client",
      WEBEX_CLIENT_SECRET: "webex-secret",
      WEBEX_REDIRECT_URI: "https://sunny-caipe.outshift.io/api/integrations/webex/callback",
    });

    expect(inputs).toEqual([
      expect.objectContaining({
        provider: "webex",
        redirectUri: "https://sunny-caipe.outshift.io/api/credentials/oauth/webex/callback",
      }),
    ]);
  });

  it("skips incomplete provider env sets and upserts only when enabled", async () => {
    const service = {
      upsertConnector: jest.fn<UpsertConnector>(async (input) => connectorMetadata(input)),
    };

    await bootstrapOAuthConnectorsFromEnv({
      env: {
        CREDENTIAL_BOOTSTRAP_OAUTH_CONNECTORS: "true",
        GITHUB_CLIENT_ID: "github-client",
        GITHUB_CLIENT_SECRET: "github-secret",
        GITHUB_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/github/callback",
        WEBEX_CLIENT_ID: "webex-client",
      },
      service,
    });

    expect(service.upsertConnector).toHaveBeenCalledTimes(1);
    expect(service.upsertConnector).toHaveBeenCalledWith(expect.objectContaining({ provider: "github" }));

    service.upsertConnector.mockClear();
    await bootstrapOAuthConnectorsFromEnv({
      env: {
        CREDENTIAL_BOOTSTRAP_OAUTH_CONNECTORS: "false",
        GITHUB_CLIENT_ID: "github-client",
        GITHUB_CLIENT_SECRET: "github-secret",
        GITHUB_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/github/callback",
      },
      service,
    });
    expect(service.upsertConnector).not.toHaveBeenCalled();
  });

  it("continues bootstrapping remaining providers when one provider fails validation", async () => {
    const service = {
      upsertConnector: jest
        .fn<UpsertConnector>()
        .mockRejectedValueOnce(new Error("redirectUri must be an external HTTPS URL"))
        .mockResolvedValueOnce(connectorMetadata({ id: "connector-2" })),
    };

    await expect(
      bootstrapOAuthConnectorsFromEnv({
        env: {
          CREDENTIAL_BOOTSTRAP_OAUTH_CONNECTORS: "true",
          GITHUB_CLIENT_ID: "github-client",
          GITHUB_CLIENT_SECRET: "github-secret",
          GITHUB_REDIRECT_URI: "http://localhost:3000/api/credentials/oauth/github/callback",
          CONFLUENCE_CLIENT_ID: "atlassian-client",
          CONFLUENCE_CLIENT_SECRET: "atlassian-secret",
          CONFLUENCE_REDIRECT_URI: "https://caipe.example.com/api/credentials/oauth/atlassian/callback",
        },
        service,
      }),
    ).resolves.toBe(1);

    expect(service.upsertConnector).toHaveBeenCalledTimes(2);
    expect(service.upsertConnector).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "atlassian" }),
    );
  });
});
