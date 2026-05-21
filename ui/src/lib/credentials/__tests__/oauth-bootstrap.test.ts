import { buildOAuthConnectorBootstrapInputs, bootstrapOAuthConnectorsFromEnv } from "../oauth-bootstrap";

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
    });

    expect(inputs.map((input) => input.provider)).toEqual(["github", "atlassian", "webex"]);
    expect(inputs[1]).toMatchObject({
      name: "Atlassian Cloud",
      clientId: "atlassian-client",
      clientSecret: "atlassian-secret",
    });
    expect(JSON.stringify(inputs)).not.toContain("oauth_connector:");
  });

  it("skips incomplete provider env sets and upserts only when enabled", async () => {
    const service = {
      upsertConnector: jest.fn(async () => ({ id: "connector-1" })),
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
        .fn()
        .mockRejectedValueOnce(new Error("redirectUri must be an external HTTPS URL"))
        .mockResolvedValueOnce({ id: "connector-2" }),
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
