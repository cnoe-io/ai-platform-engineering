import { randomUUID } from "crypto";

import { ApiError } from "@/lib/api-error";

import type { CredentialOwnerRef } from "./types";

interface Collection<T extends object> {
  insertOne(doc: T): Promise<unknown>;
  findOne(query: Record<string, unknown>): Promise<T | null>;
  find?(): { sort(sort: Record<string, 1 | -1>): { toArray(): Promise<T[]> } };
  updateOne?(query: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
}

interface PayloadStore {
  getSecret?(secretRefId: string): Promise<string>;
  putSecret(input: { secretRefId: string; plaintext: string }): Promise<void>;
}

export interface OAuthConnectorDocument {
  id: string;
  name: string;
  provider: string;
  clientId: string;
  clientSecretRef: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type OAuthConnectorMetadata = Omit<OAuthConnectorDocument, "clientSecretRef"> & {
  clientSecretConfigured: true;
};

export interface ProviderConnectionDocument {
  id: string;
  connectorId: string;
  provider?: string;
  owner: CredentialOwnerRef;
  status: "connected" | "needs_reauth" | "disabled";
  refreshTokenRef: string;
  accessTokenRef: string;
  expiresAt?: Date;
  updatedAt?: Date;
}

export interface ProviderConnectionMetadata {
  id: string;
  connectorId: string;
  provider: string;
  owner: CredentialOwnerRef;
  status: ProviderConnectionDocument["status"];
  expiresAt?: Date;
  updatedAt?: Date;
}

export interface OAuthConnectorServiceOptions {
  connectorsCollection: Collection<OAuthConnectorDocument>;
  payloadStore: PayloadStore;
  idGenerator: () => string;
  now?: () => Date;
}

export interface CreateConnectorInput {
  name: string;
  provider: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
}

export interface TokenClientResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface ProviderConnectionServiceOptions {
  providerConnectionsCollection: Collection<ProviderConnectionDocument>;
  connectorsCollection: Collection<OAuthConnectorDocument>;
  payloadStore: Required<Pick<PayloadStore, "getSecret" | "putSecret">>;
  tokenClient: (tokenUrl: string, body: Record<string, string>) => Promise<TokenClientResponse>;
  idGenerator?: () => string;
  now?: () => Date;
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(`${field} is required`, 400, "VALIDATION_ERROR");
  }
  return trimmed;
}

function validateExternalHttpsUrl(value: string, field: string): string {
  const url = new URL(nonEmpty(value, field));
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ) {
    throw new ApiError(`${field} must be an external HTTPS URL`, 400, "VALIDATION_ERROR");
  }
  return url.toString();
}

function validateRedirectUri(value: string): string {
  const url = new URL(nonEmpty(value, "redirectUri"));
  const hostname = url.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (url.protocol === "https:") {
    return url.toString();
  }
  if (process.env.NODE_ENV !== "production" && url.protocol === "http:" && isLocalhost) {
    return url.toString();
  }
  throw new ApiError(
    "redirectUri must be HTTPS; localhost HTTP is allowed only outside production",
    400,
    "VALIDATION_ERROR",
  );
}

function toConnectorMetadata(doc: OAuthConnectorDocument): OAuthConnectorMetadata {
  const metadata = {
    id: doc.id,
    name: doc.name,
    provider: doc.provider,
    clientId: doc.clientId,
    authorizationUrl: doc.authorizationUrl,
    tokenUrl: doc.tokenUrl,
    scopes: doc.scopes,
    redirectUri: doc.redirectUri,
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  return { ...metadata, clientSecretConfigured: true };
}

export class OAuthConnectorService {
  private readonly connectorsCollection: Collection<OAuthConnectorDocument>;
  private readonly payloadStore: PayloadStore;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;

  constructor(options: OAuthConnectorServiceOptions) {
    this.connectorsCollection = options.connectorsCollection;
    this.payloadStore = options.payloadStore;
    this.idGenerator = options.idGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async createConnector(input: CreateConnectorInput): Promise<OAuthConnectorMetadata> {
    const id = this.idGenerator();
    const clientSecretRef = `oauth_connector:${id}:client_secret`;
    const now = this.now();
    const doc: OAuthConnectorDocument = {
      id,
      name: nonEmpty(input.name, "name"),
      provider: nonEmpty(input.provider, "provider"),
      clientId: nonEmpty(input.clientId, "clientId"),
      clientSecretRef,
      authorizationUrl: validateExternalHttpsUrl(input.authorizationUrl, "authorizationUrl"),
      tokenUrl: validateExternalHttpsUrl(input.tokenUrl, "tokenUrl"),
      scopes: input.scopes.map((scope) => scope.trim()).filter(Boolean),
      redirectUri: validateRedirectUri(input.redirectUri),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.payloadStore.putSecret({ secretRefId: clientSecretRef, plaintext: nonEmpty(input.clientSecret, "clientSecret") });
    await this.connectorsCollection.insertOne(doc);
    return toConnectorMetadata(doc);
  }

  async upsertConnector(input: CreateConnectorInput): Promise<OAuthConnectorMetadata> {
    const existing = await this.connectorsCollection.findOne({
      provider: nonEmpty(input.provider, "provider"),
    });
    if (!existing) {
      return this.createConnector(input);
    }

    const now = this.now();
    const update: Partial<OAuthConnectorDocument> = {
      name: nonEmpty(input.name, "name"),
      clientId: nonEmpty(input.clientId, "clientId"),
      authorizationUrl: validateExternalHttpsUrl(input.authorizationUrl, "authorizationUrl"),
      tokenUrl: validateExternalHttpsUrl(input.tokenUrl, "tokenUrl"),
      scopes: input.scopes.map((scope) => scope.trim()).filter(Boolean),
      redirectUri: validateRedirectUri(input.redirectUri),
      enabled: true,
      updatedAt: now,
    };
    await this.payloadStore.putSecret({
      secretRefId: existing.clientSecretRef,
      plaintext: nonEmpty(input.clientSecret, "clientSecret"),
    });
    await this.connectorsCollection.updateOne?.({ id: existing.id }, { $set: update });
    return toConnectorMetadata({ ...existing, ...update });
  }

  async listConnectors(): Promise<OAuthConnectorMetadata[]> {
    if (!this.connectorsCollection.find) {
      return [];
    }
    const docs = await this.connectorsCollection.find().sort({ provider: 1 }).toArray();
    return docs.map(toConnectorMetadata);
  }

  async setConnectorEnabled(connectorId: string, enabled: boolean): Promise<void> {
    await this.connectorsCollection.updateOne?.(
      { id: nonEmpty(connectorId, "connectorId") },
      { $set: { enabled, updatedAt: this.now() } },
    );
  }

  async testConnector(connectorId: string): Promise<{ ok: true; connectorId: string }> {
    const connector = await this.connectorsCollection.findOne({ id: nonEmpty(connectorId, "connectorId") });
    if (!connector) {
      throw new ApiError("OAuth connector was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    validateExternalHttpsUrl(connector.authorizationUrl, "authorizationUrl");
    validateExternalHttpsUrl(connector.tokenUrl, "tokenUrl");
    return { ok: true, connectorId };
  }
}

export class ProviderConnectionService {
  private readonly providerConnectionsCollection: Collection<ProviderConnectionDocument>;
  private readonly connectorsCollection: Collection<OAuthConnectorDocument>;
  private readonly payloadStore: Required<Pick<PayloadStore, "getSecret" | "putSecret">>;
  private readonly tokenClient: ProviderConnectionServiceOptions["tokenClient"];
  private readonly idGenerator: () => string;
  private readonly now: () => Date;

  constructor(options: ProviderConnectionServiceOptions) {
    this.providerConnectionsCollection = options.providerConnectionsCollection;
    this.connectorsCollection = options.connectorsCollection;
    this.payloadStore = options.payloadStore;
    this.tokenClient = options.tokenClient;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  private async findEnabledConnector(providerKey: string): Promise<OAuthConnectorDocument> {
    const connector = await this.connectorsCollection.findOne({ provider: providerKey, enabled: true });
    if (!connector) {
      throw new ApiError("OAuth connector was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    return connector;
  }

  async startConnection(input: {
    providerKey: string;
    owner: CredentialOwnerRef;
    state: string;
    codeChallenge: string;
  }): Promise<{ authorizationUrl: string; connectorId: string }> {
    const connector = await this.findEnabledConnector(nonEmpty(input.providerKey, "providerKey"));
    const url = new URL(connector.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", connector.clientId);
    url.searchParams.set("redirect_uri", connector.redirectUri);
    url.searchParams.set("scope", connector.scopes.join(" "));
    url.searchParams.set("state", nonEmpty(input.state, "state"));
    url.searchParams.set("code_challenge", nonEmpty(input.codeChallenge, "codeChallenge"));
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), connectorId: connector.id };
  }

  async completeConnection(input: {
    providerKey: string;
    owner: CredentialOwnerRef;
    code: string;
    codeVerifier: string;
  }): Promise<ProviderConnectionMetadata> {
    const connector = await this.findEnabledConnector(nonEmpty(input.providerKey, "providerKey"));
    const clientSecret = await this.payloadStore.getSecret(connector.clientSecretRef);
    const token = await this.tokenClient(connector.tokenUrl, {
      grant_type: "authorization_code",
      client_id: connector.clientId,
      client_secret: clientSecret,
      code: nonEmpty(input.code, "code"),
      code_verifier: nonEmpty(input.codeVerifier, "codeVerifier"),
      redirect_uri: connector.redirectUri,
    });

    const id = this.idGenerator();
    const accessTokenRef = `provider_connection:${id}:access_token`;
    const refreshTokenRef = `provider_connection:${id}:refresh_token`;
    await this.payloadStore.putSecret({
      secretRefId: accessTokenRef,
      plaintext: nonEmpty(token.access_token, "access_token"),
    });
    if (token.refresh_token) {
      await this.payloadStore.putSecret({
        secretRefId: refreshTokenRef,
        plaintext: token.refresh_token,
      });
    }

    const now = this.now();
    const doc: ProviderConnectionDocument = {
      id,
      connectorId: connector.id,
      provider: connector.provider,
      owner: input.owner,
      status: token.refresh_token ? "connected" : "needs_reauth",
      accessTokenRef,
      refreshTokenRef,
      expiresAt: token.expires_in ? new Date(now.getTime() + token.expires_in * 1000) : undefined,
      updatedAt: now,
    };
    await this.providerConnectionsCollection.insertOne(doc);
    return toProviderConnectionMetadata(doc);
  }

  async listConnections(owner: CredentialOwnerRef): Promise<ProviderConnectionMetadata[]> {
    if (!this.providerConnectionsCollection.find) {
      return [];
    }
    const docs = await this.providerConnectionsCollection.find().sort({ updatedAt: -1 }).toArray();
    return docs
      .filter((doc) => doc.owner.type === owner.type && doc.owner.id === owner.id)
      .map(toProviderConnectionMetadata);
  }

  async getConnection(connectionId: string): Promise<ProviderConnectionMetadata> {
    const connection = await this.providerConnectionsCollection.findOne({ id: nonEmpty(connectionId, "connectionId") });
    if (!connection) {
      throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    return toProviderConnectionMetadata(connection);
  }

  async refreshConnection(connectionId: string): Promise<{ accessToken: string; expiresIn?: number }> {
    const connection = await this.providerConnectionsCollection.findOne({ id: connectionId });
    if (!connection) {
      throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    const connector = await this.connectorsCollection.findOne({ id: connection.connectorId });
    if (!connector) {
      throw new ApiError("OAuth connector was not found", 404, "CREDENTIAL_NOT_FOUND");
    }

    const [clientSecret, refreshToken] = await Promise.all([
      this.payloadStore.getSecret(connector.clientSecretRef),
      this.payloadStore.getSecret(connection.refreshTokenRef),
    ]);
    const token = await this.tokenClient(connector.tokenUrl, {
      grant_type: "refresh_token",
      client_id: connector.clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    await this.payloadStore.putSecret({
      secretRefId: connection.accessTokenRef,
      plaintext: nonEmpty(token.access_token, "access_token"),
    });
    if (token.refresh_token) {
      await this.payloadStore.putSecret({
        secretRefId: connection.refreshTokenRef,
        plaintext: token.refresh_token,
      });
    }
    await this.providerConnectionsCollection.updateOne?.(
      { id: connectionId },
      {
        $set: {
          status: "connected",
          expiresAt: token.expires_in ? new Date(this.now().getTime() + token.expires_in * 1000) : undefined,
          updatedAt: this.now(),
        },
      },
    );

    return { accessToken: token.access_token, expiresIn: token.expires_in };
  }
}

function toProviderConnectionMetadata(
  doc: ProviderConnectionDocument,
): ProviderConnectionMetadata {
  return {
    id: doc.id,
    connectorId: doc.connectorId,
    provider: doc.provider ?? doc.connectorId,
    owner: doc.owner,
    status: doc.status,
    expiresAt: doc.expiresAt,
    updatedAt: doc.updatedAt,
  };
}
