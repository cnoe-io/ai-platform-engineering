import { OAuthConnectorService, ProviderConnectionService } from "@/lib/credentials/oauth-service";

class MemoryCollection {
  docs: Record<string, unknown>[] = [];

  async insertOne(doc: Record<string, unknown>) {
    this.docs.push(doc);
    return { acknowledged: true };
  }

  async findOne(query: Record<string, unknown>) {
    return this.docs.find((doc) => Object.entries(query).every(([key, value]) => doc[key] === value)) ?? null;
  }

  find() {
    return {
      sort: () => ({
        toArray: async () => this.docs,
      }),
    };
  }

  async updateOne(query: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
    const doc = await this.findOne(query);
    if (!doc) return { matchedCount: 0 };
    Object.assign(doc, update.$set ?? {});
    return { matchedCount: 1 };
  }
}

describe("OAuthConnectorService", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      writable: true,
      configurable: true,
    });
  });

  it("creates a dynamic standard OAuth connector with secret material in the encrypted store", async () => {
    const connectors = new MemoryCollection();
    const payloadStore = { putSecret: jest.fn(async () => undefined) };
    const service = new OAuthConnectorService({
      connectorsCollection: connectors,
      payloadStore,
      idGenerator: () => "connector-1",
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    const connector = await service.createConnector({
      name: "GitHub Enterprise",
      provider: "github",
      clientId: "client-id",
      clientSecret: "client-secret",
      authorizationUrl: "https://github.example.com/login/oauth/authorize",
      tokenUrl: "https://github.example.com/login/oauth/access_token",
      scopes: ["repo", "offline_access"],
      redirectUri: "https://caipe.example.com/api/credentials/oauth/callback",
    });

    expect(connector).toMatchObject({
      id: "connector-1",
      provider: "github",
      clientSecretConfigured: true,
    });
    expect(connector).not.toHaveProperty("clientSecretRef");
    expect(JSON.stringify(connectors.docs)).not.toContain("client-secret");
    expect(payloadStore.putSecret).toHaveBeenCalledWith({
      secretRefId: "oauth_connector:connector-1:client_secret",
      plaintext: "client-secret",
    });
  });

  it("rejects non-https OAuth endpoints and localhost SSRF targets", async () => {
    const service = new OAuthConnectorService({
      connectorsCollection: new MemoryCollection(),
      payloadStore: { putSecret: jest.fn(async () => undefined) },
      idGenerator: () => "connector-1",
    });

    await expect(
      service.createConnector({
        name: "Unsafe",
        provider: "unsafe",
        clientId: "client-id",
        clientSecret: "client-secret",
        authorizationUrl: "http://localhost:8080/auth",
        tokenUrl: "https://example.com/token",
        scopes: ["offline_access"],
        redirectUri: "https://caipe.example.com/callback",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("upserts an existing connector and rotates encrypted client secret material", async () => {
    const connectors = new MemoryCollection();
    connectors.docs.push({
      id: "connector-1",
      name: "GitHub",
      provider: "github",
      clientId: "old-client",
      clientSecretRef: "oauth_connector:connector-1:client_secret",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo"],
      redirectUri: "https://old.example.com/callback",
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const payloadStore = { putSecret: jest.fn(async () => undefined) };
    const service = new OAuthConnectorService({
      connectorsCollection: connectors,
      payloadStore,
      idGenerator: () => "connector-new",
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    const connector = await service.upsertConnector({
      name: "GitHub",
      provider: "github",
      clientId: "new-client",
      clientSecret: "new-client-secret",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "read:user"],
      redirectUri: "https://caipe.example.com/api/credentials/oauth/github/callback",
    });

    expect(connector).toMatchObject({
      id: "connector-1",
      clientId: "new-client",
      clientSecretConfigured: true,
    });
    expect(connectors.docs).toHaveLength(1);
    expect(connectors.docs[0]).toMatchObject({
      id: "connector-1",
      provider: "github",
      clientSecretRef: "oauth_connector:connector-1:client_secret",
    });
    expect(JSON.stringify(connectors.docs)).not.toContain("new-client-secret");
    expect(payloadStore.putSecret).toHaveBeenCalledWith({
      secretRefId: "oauth_connector:connector-1:client_secret",
      plaintext: "new-client-secret",
    });
  });

  it("allows localhost redirect URIs outside production but rejects them in production", async () => {
    const connectors = new MemoryCollection();
    const payloadStore = { putSecret: jest.fn(async () => undefined) };
    const service = new OAuthConnectorService({
      connectorsCollection: connectors,
      payloadStore,
      idGenerator: () => "connector-1",
    });

    await expect(
      service.createConnector({
        name: "GitHub Local",
        provider: "github",
        clientId: "client-id",
        clientSecret: "client-secret",
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scopes: ["repo"],
        redirectUri: "http://localhost:3000/api/credentials/oauth/github/callback",
      }),
    ).resolves.toMatchObject({ provider: "github" });

    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      writable: true,
      configurable: true,
    });
    const productionService = new OAuthConnectorService({
      connectorsCollection: new MemoryCollection(),
      payloadStore,
      idGenerator: () => "connector-2",
    });

    await expect(
      productionService.createConnector({
        name: "GitHub Local",
        provider: "github",
        clientId: "client-id",
        clientSecret: "client-secret",
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scopes: ["repo"],
        redirectUri: "http://localhost:3000/api/credentials/oauth/github/callback",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("ProviderConnectionService", () => {
  it("refreshes provider tokens using connector metadata and stores rotated tokens encrypted", async () => {
    const providerConnections = new MemoryCollection();
    providerConnections.docs.push({
      id: "conn-1",
      connectorId: "connector-1",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
      refreshTokenRef: "provider_connection:conn-1:refresh_token",
      accessTokenRef: "provider_connection:conn-1:access_token",
    });
    const connectors = new MemoryCollection();
    connectors.docs.push({
      id: "connector-1",
      clientId: "client-id",
      clientSecretRef: "oauth_connector:connector-1:client_secret",
      tokenUrl: "https://github.example.com/login/oauth/access_token",
      scopes: ["repo", "offline_access"],
    });
    const payloadStore = {
      getSecret: jest.fn(async (ref: string) => `${ref}:value`),
      putSecret: jest.fn(async () => undefined),
    };
    const tokenClient = jest.fn(async () => ({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
    }));
    const service = new ProviderConnectionService({
      providerConnectionsCollection: providerConnections,
      connectorsCollection: connectors,
      payloadStore,
      tokenClient,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    const token = await service.refreshConnection("conn-1");

    expect(token).toEqual({ accessToken: "new-access-token", expiresIn: 3600 });
    expect(tokenClient).toHaveBeenCalledWith(
      "https://github.example.com/login/oauth/access_token",
      expect.objectContaining({
        client_id: "client-id",
        client_secret: "oauth_connector:connector-1:client_secret:value",
        grant_type: "refresh_token",
        refresh_token: "provider_connection:conn-1:refresh_token:value",
      }),
    );
    expect(payloadStore.putSecret).toHaveBeenCalledWith({
      secretRefId: "provider_connection:conn-1:access_token",
      plaintext: "new-access-token",
    });
    expect(payloadStore.putSecret).toHaveBeenCalledWith({
      secretRefId: "provider_connection:conn-1:refresh_token",
      plaintext: "new-refresh-token",
    });
  });

  it("starts and completes an OAuth connection without exposing provider tokens", async () => {
    const connectors = new MemoryCollection();
    const connections = new MemoryCollection();
    const payloadStore = {
      getSecret: jest.fn(async (ref: string) => {
        if (ref === "oauth_connector:connector-1:client_secret") return "client-secret";
        return "stored";
      }),
      putSecret: jest.fn(async () => undefined),
    };
    connectors.docs.push({
      id: "connector-1",
      name: "GitHub",
      provider: "github",
      clientId: "client-id",
      clientSecretRef: "oauth_connector:connector-1:client_secret",
      authorizationUrl: "https://github.example.com/login/oauth/authorize",
      tokenUrl: "https://github.example.com/login/oauth/access_token",
      scopes: ["repo", "offline_access"],
      redirectUri: "https://caipe.example.com/api/credentials/oauth/github/callback",
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const service = new ProviderConnectionService({
      providerConnectionsCollection: connections,
      connectorsCollection: connectors,
      payloadStore,
      tokenClient: jest.fn(async () => ({
        access_token: "provider-access-token",
        refresh_token: "provider-refresh-token",
        expires_in: 3600,
      })),
      idGenerator: () => "provider-connection-1",
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    const start = await service.startConnection({
      providerKey: "github",
      owner: { type: "user", id: "alice-sub" },
      state: "state-1",
      codeChallenge: "challenge-1",
    });
    expect(start.authorizationUrl).toContain("state=state-1");
    expect(start.authorizationUrl).toContain("code_challenge=challenge-1");
    expect(start.authorizationUrl).toContain("code_challenge_method=S256");

    const completed = await service.completeConnection({
      providerKey: "github",
      owner: { type: "user", id: "alice-sub" },
      code: "provider-code",
      codeVerifier: "verifier-1",
    });

    expect(completed).toMatchObject({
      id: "provider-connection-1",
      provider: "github",
      status: "connected",
    });
    expect(JSON.stringify(completed)).not.toContain("provider-access-token");
    expect(JSON.stringify(completed)).not.toContain("provider-refresh-token");
    expect(payloadStore.putSecret).toHaveBeenCalledWith({
      secretRefId: "provider_connection:provider-connection-1:access_token",
      plaintext: "provider-access-token",
    });
    expect(payloadStore.putSecret).toHaveBeenCalledWith({
      secretRefId: "provider_connection:provider-connection-1:refresh_token",
      plaintext: "provider-refresh-token",
    });
  });

  it("lists provider connection metadata for an owner without token refs", async () => {
    const providerConnections = new MemoryCollection();
    providerConnections.docs.push({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "github",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
      refreshTokenRef: "provider_connection:conn-1:refresh_token",
      accessTokenRef: "provider_connection:conn-1:access_token",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const service = new ProviderConnectionService({
      providerConnectionsCollection: providerConnections,
      connectorsCollection: new MemoryCollection(),
      payloadStore: {
        getSecret: jest.fn(async () => "secret"),
        putSecret: jest.fn(async () => undefined),
      },
      tokenClient: jest.fn(async () => ({ access_token: "token" })),
    });

    await expect(service.listConnections({ type: "user", id: "alice-sub" })).resolves.toEqual([
      {
        id: "conn-1",
        connectorId: "connector-1",
        provider: "github",
        owner: { type: "user", id: "alice-sub" },
        status: "connected",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });
});
