import { randomUUID } from "crypto";

import { ApiError } from "@/lib/api-error";

import {
  createCertificateClientAssertion,
  inspectCertificatePfx,
  type CertificateInspection,
} from "./certificate-oauth";
import type { CredentialOwnerRef } from "./types";

interface Collection<T extends object> {
  insertOne(doc: T): Promise<unknown>;
  findOne(query: Record<string, unknown>): Promise<T | null>;
  find?(): { sort(sort: Record<string, 1 | -1>): { toArray(): Promise<T[]> } };
  updateOne?(query: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  updateMany?(
    query: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount?: number }>;
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
  certificateRef?: string;
  certificatePasswordRef?: string;
  certificateThumbprint?: string;
  certificateExpiresAt?: Date;
  authType?: "authorization_code" | "client_certificate";
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  enabled: boolean;
  pkce?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type OAuthConnectorMetadata = Omit<
  OAuthConnectorDocument,
  "clientSecretRef" | "certificateRef" | "certificatePasswordRef"
> & {
  clientSecretConfigured: boolean;
  certificateConfigured: boolean;
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
  connectedAt?: Date;
  updatedAt?: Date;
  profileSummary?: string;
  profileCheckedAt?: Date;
  // Whether the connection can silently renew its access token via a refresh
  // grant. False for refresh-less tokens (public/PKCE clients, pasted PATs):
  // the connection is usable now but will require manual re-auth at expiry.
  // Absent on legacy connections ⇒ treat as unknown (assume renewable).
  renewable?: boolean;
  // What this user asked for at connect time (a subset of the connector's
  // scopes). Absent on legacy connections ⇒ "used the connector default".
  requestedScopes?: string[];
  // What the IdP actually granted (when the token response carries `scope`).
  grantedScopes?: string[];
}

export interface ProviderConnectionMetadata {
  id: string;
  connectorId: string;
  provider: string;
  owner: CredentialOwnerRef;
  status: ProviderConnectionDocument["status"];
  expiresAt?: Date;
  connectedAt?: Date;
  updatedAt?: Date;
  // See ProviderConnectionDocument.renewable. Lets the UI distinguish a
  // self-renewing connection from one that is valid now but will expire.
  renewable?: boolean;
  profileSummary?: string;
  profileCheckedAt?: Date;
  requestedScopes?: string[];
  grantedScopes?: string[];
}

export type CompletedProviderConnection = ProviderConnectionMetadata & {
  supersededConnectionIds?: string[];
};

export interface OAuthConnectorServiceOptions {
  connectorsCollection: Collection<OAuthConnectorDocument>;
  payloadStore: PayloadStore;
  idGenerator: () => string;
  now?: () => Date;
  inspectCertificate?: (input: {
    pfxBase64: string;
    password: string;
    expectedThumbprint?: string;
  }) => CertificateInspection;
}

export interface CreateConnectorInput {
  name: string;
  provider: string;
  clientId: string;
  clientSecret?: string;
  authType?: "authorization_code" | "client_certificate";
  certificatePfx?: string;
  certificatePassword?: string;
  certificateThumbprint?: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  pkce?: boolean;
}

export interface TokenClientResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  // Space-delimited scopes the IdP granted (RFC 6749 §5.1). Optional; many
  // providers echo it back on the token response.
  scope?: string;
}

export interface ProviderConnectionServiceOptions {
  providerConnectionsCollection: Collection<ProviderConnectionDocument>;
  connectorsCollection: Collection<OAuthConnectorDocument>;
  payloadStore: Required<Pick<PayloadStore, "getSecret" | "putSecret">>;
  tokenClient: (tokenUrl: string, body: Record<string, string>) => Promise<TokenClientResponse>;
  certificateAssertionFactory?: typeof createCertificateClientAssertion;
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

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function validateRedirectUri(value: string): string {
  const url = new URL(nonEmpty(value, "redirectUri"));
  const hostname = url.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (url.protocol === "https:") {
    return url.toString();
  }
  if (
    url.protocol === "http:" &&
    isLocalhost &&
    (
      process.env.NODE_ENV !== "production" ||
      enabled(process.env.CREDENTIAL_ALLOW_LOCALHOST_OAUTH_REDIRECTS)
    )
  ) {
    return url.toString();
  }
  throw new ApiError(
    "redirectUri must be HTTPS; localhost HTTP requires CREDENTIAL_ALLOW_LOCALHOST_OAUTH_REDIRECTS=true under production",
    400,
    "VALIDATION_ERROR",
  );
}

function toConnectorMetadata(doc: OAuthConnectorDocument): OAuthConnectorMetadata {
  return {
    id: doc.id,
    name: doc.name,
    provider: doc.provider,
    clientId: doc.clientId,
    authorizationUrl: doc.authorizationUrl,
    tokenUrl: doc.tokenUrl,
    scopes: doc.scopes,
    redirectUri: doc.redirectUri,
    enabled: doc.enabled,
    authType: doc.authType ?? "authorization_code",
    pkce: doc.pkce,
    certificateThumbprint: doc.certificateThumbprint,
    certificateExpiresAt: doc.certificateExpiresAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    clientSecretConfigured:
      (doc.authType ?? "authorization_code") === "authorization_code" &&
      doc.pkce !== true,
    certificateConfigured:
      doc.authType === "client_certificate" &&
      Boolean(doc.certificateRef && doc.certificatePasswordRef),
  };
}

function authorizationScopes(provider: string, scopes: string[]): string[] {
  if (provider.toLowerCase() !== "github") {
    return scopes;
  }
  return scopes.filter((scope) => scope !== "offline_access");
}

/**
 * Bound a per-user scope selection to what the connector permits.
 *
 * The connector's `scopes` array is both the allowed upper bound and the
 * default selection: a user may only **narrow** within it (no privilege
 * escalation). `requested === undefined` preserves today's behavior (request
 * the full connector set). Out-of-bounds or empty selections are rejected so a
 * tampered request cannot ask for scopes the connector/OAuth app never allowed,
 * and we never mint a zero-scope token.
 */
export function boundScopes(connectorScopes: string[], requested?: string[]): string[] {
  const allowed = connectorScopes.map((scope) => scope.trim()).filter(Boolean);
  if (requested === undefined) {
    return allowed;
  }
  const normalized = Array.from(new Set(requested.map((scope) => scope.trim()).filter(Boolean)));
  const outOfBounds = normalized.filter((scope) => !allowed.includes(scope));
  if (outOfBounds.length > 0) {
    throw new ApiError(
      `Requested scopes are not permitted by this connector: ${outOfBounds.join(", ")}`,
      400,
      "VALIDATION_ERROR",
    );
  }
  // Preserve connector order for stable authorization URLs and tests.
  const selected = allowed.filter((scope) => normalized.includes(scope));
  if (selected.length === 0) {
    throw new ApiError("At least one scope must be selected", 400, "VALIDATION_ERROR");
  }
  return selected;
}

function authorizationCodeTokenBody(input: {
  provider: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  pkce?: boolean;
}): Record<string, string> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: nonEmpty(input.code, "code"),
    code_verifier: nonEmpty(input.codeVerifier, "codeVerifier"),
    redirect_uri: input.redirectUri,
  };
  const omitSecret = input.pkce === true || input.provider.toLowerCase() === "pagerduty";
  if (!omitSecret) {
    body.client_secret = input.clientSecret;
  }
  return body;
}

function refreshTokenBody(input: {
  provider: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  pkce?: boolean;
}): Record<string, string> {
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  };
  const omitSecret = input.pkce === true || input.provider.toLowerCase() === "pagerduty";
  if (!omitSecret) {
    body.client_secret = input.clientSecret;
  }
  return body;
}

function certificateClientCredentialsTokenBody(input: {
  clientId: string;
  clientAssertion: string;
  scopes: string[];
}): Record<string, string> {
  return {
    grant_type: "client_credentials",
    client_id: input.clientId,
    scope: input.scopes.join(" "),
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: input.clientAssertion,
  };
}

export class OAuthConnectorService {
  private readonly connectorsCollection: Collection<OAuthConnectorDocument>;
  private readonly payloadStore: PayloadStore;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;
  private readonly inspectCertificate: NonNullable<
    OAuthConnectorServiceOptions["inspectCertificate"]
  >;

  constructor(options: OAuthConnectorServiceOptions) {
    this.connectorsCollection = options.connectorsCollection;
    this.payloadStore = options.payloadStore;
    this.idGenerator = options.idGenerator;
    this.now = options.now ?? (() => new Date());
    this.inspectCertificate = options.inspectCertificate ?? inspectCertificatePfx;
  }

  async createConnector(input: CreateConnectorInput): Promise<OAuthConnectorMetadata> {
    const id = this.idGenerator();
    const clientSecretRef = `oauth_connector:${id}:client_secret`;
    const certificateRef = `oauth_connector:${id}:certificate_pfx`;
    const certificatePasswordRef = `oauth_connector:${id}:certificate_password`;
    const now = this.now();
    const authType = input.authType ?? "authorization_code";
    const certificate =
      authType === "client_certificate"
        ? this.inspectCertificate({
            pfxBase64: nonEmpty(input.certificatePfx ?? "", "certificatePfx"),
            password: nonEmpty(input.certificatePassword ?? "", "certificatePassword"),
            expectedThumbprint: input.certificateThumbprint,
          })
        : undefined;
    const doc: OAuthConnectorDocument = {
      id,
      name: nonEmpty(input.name, "name"),
      provider: nonEmpty(input.provider, "provider"),
      clientId: nonEmpty(input.clientId, "clientId"),
      clientSecretRef,
      ...(certificate
        ? {
            authType: "client_certificate" as const,
            certificateRef,
            certificatePasswordRef,
            certificateThumbprint: certificate.thumbprint,
            certificateExpiresAt: certificate.expiresAt,
          }
        : {}),
      authorizationUrl: validateExternalHttpsUrl(input.authorizationUrl, "authorizationUrl"),
      tokenUrl: validateExternalHttpsUrl(input.tokenUrl, "tokenUrl"),
      scopes: input.scopes.map((scope) => scope.trim()).filter(Boolean),
      redirectUri: validateRedirectUri(input.redirectUri),
      enabled: true,
      ...(authType === "authorization_code" && input.pkce ? { pkce: true } : {}),
      createdAt: now,
      updatedAt: now,
    };

    if (authType === "client_certificate") {
      await this.payloadStore.putSecret({
        secretRefId: certificateRef,
        plaintext: nonEmpty(input.certificatePfx ?? "", "certificatePfx"),
      });
      await this.payloadStore.putSecret({
        secretRefId: certificatePasswordRef,
        plaintext: nonEmpty(input.certificatePassword ?? "", "certificatePassword"),
      });
    } else if (!input.pkce) {
      await this.payloadStore.putSecret({ secretRefId: clientSecretRef, plaintext: nonEmpty(input.clientSecret ?? "", "clientSecret") });
    }
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
    const authType = input.authType ?? "authorization_code";
    const certificate =
      authType === "client_certificate"
        ? this.inspectCertificate({
            pfxBase64: nonEmpty(input.certificatePfx ?? "", "certificatePfx"),
            password: nonEmpty(input.certificatePassword ?? "", "certificatePassword"),
            expectedThumbprint: input.certificateThumbprint,
          })
        : undefined;
    const certificateRef =
      existing.certificateRef ?? `oauth_connector:${existing.id}:certificate_pfx`;
    const certificatePasswordRef =
      existing.certificatePasswordRef ??
      `oauth_connector:${existing.id}:certificate_password`;
    const update: Partial<OAuthConnectorDocument> = {
      name: nonEmpty(input.name, "name"),
      clientId: nonEmpty(input.clientId, "clientId"),
      authType,
      authorizationUrl: validateExternalHttpsUrl(input.authorizationUrl, "authorizationUrl"),
      tokenUrl: validateExternalHttpsUrl(input.tokenUrl, "tokenUrl"),
      scopes: input.scopes.map((scope) => scope.trim()).filter(Boolean),
      redirectUri: validateRedirectUri(input.redirectUri),
      enabled: true,
      ...(authType === "authorization_code" && input.pkce ? { pkce: true } : {}),
      ...(certificate
        ? {
            certificateRef,
            certificatePasswordRef,
            certificateThumbprint: certificate.thumbprint,
            certificateExpiresAt: certificate.expiresAt,
          }
        : {}),
      updatedAt: now,
    };
    if (authType === "client_certificate") {
      await this.payloadStore.putSecret({
        secretRefId: certificateRef,
        plaintext: nonEmpty(input.certificatePfx ?? "", "certificatePfx"),
      });
      await this.payloadStore.putSecret({
        secretRefId: certificatePasswordRef,
        plaintext: nonEmpty(input.certificatePassword ?? "", "certificatePassword"),
      });
    } else if (!input.pkce) {
      await this.payloadStore.putSecret({
        secretRefId: existing.clientSecretRef,
        plaintext: nonEmpty(input.clientSecret ?? "", "clientSecret"),
      });
    }
    // `$set: { pkce: undefined }` is a no-op in MongoDB, so a PKCE→confidential
    // switch must explicitly `$unset` the flag to clear it (mirrors
    // updateConnector). Without this an env-bootstrap that flips an existing
    // PKCE connector back to confidential would leave pkce:true, and runtime
    // token exchange would send an empty client secret.
    const writeUpdate =
      authType === "authorization_code" && input.pkce
        ? { $set: update }
        : { $set: update, $unset: { pkce: "" } };
    await this.connectorsCollection.updateOne?.({ id: existing.id }, writeUpdate);
    return toConnectorMetadata({
      ...existing,
      ...update,
      pkce:
        authType === "authorization_code" && input.pkce ? true : undefined,
    });
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

  async updateConnector(connectorId: string, input: CreateConnectorInput): Promise<OAuthConnectorMetadata> {
    const existing = await this.connectorsCollection.findOne({ id: nonEmpty(connectorId, "connectorId") });
    if (!existing) {
      throw new ApiError("OAuth connector was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    const now = this.now();
    const authType = input.authType ?? "authorization_code";
    const hasCertificatePfx = Boolean(input.certificatePfx?.trim());
    const hasCertificatePassword = Boolean(input.certificatePassword);
    if (hasCertificatePfx !== hasCertificatePassword) {
      throw new ApiError(
        "PFX certificate and password must be provided together",
        400,
        "VALIDATION_ERROR",
      );
    }
    const rotatingCertificate =
      authType === "client_certificate" &&
      hasCertificatePfx &&
      hasCertificatePassword;
    if (
      authType === "client_certificate" &&
      !rotatingCertificate &&
      (
        existing.authType !== "client_certificate" ||
        !existing.certificateRef ||
        !existing.certificatePasswordRef
      )
    ) {
      throw new ApiError(
        "PFX certificate and password are required for certificate OAuth",
        400,
        "VALIDATION_ERROR",
      );
    }
    const certificate = rotatingCertificate
      ? this.inspectCertificate({
          pfxBase64: nonEmpty(input.certificatePfx ?? "", "certificatePfx"),
          password: nonEmpty(input.certificatePassword ?? "", "certificatePassword"),
          expectedThumbprint: input.certificateThumbprint,
        })
      : undefined;
    if (
      authType === "client_certificate" &&
      !rotatingCertificate &&
      input.certificateThumbprint?.trim() &&
      input.certificateThumbprint.replace(/[^0-9a-f]/gi, "").toUpperCase() !==
        existing.certificateThumbprint
    ) {
      throw new ApiError(
        "Upload the PFX again to change or verify its thumbprint",
        400,
        "VALIDATION_ERROR",
      );
    }
    const certificateRef =
      existing.certificateRef ?? `oauth_connector:${existing.id}:certificate_pfx`;
    const certificatePasswordRef =
      existing.certificatePasswordRef ??
      `oauth_connector:${existing.id}:certificate_password`;
    const update: Partial<OAuthConnectorDocument> = {
      name: nonEmpty(input.name, "name"),
      clientId: nonEmpty(input.clientId, "clientId"),
      authType,
      authorizationUrl: validateExternalHttpsUrl(input.authorizationUrl, "authorizationUrl"),
      tokenUrl: validateExternalHttpsUrl(input.tokenUrl, "tokenUrl"),
      scopes: input.scopes.map((scope) => scope.trim()).filter(Boolean),
      redirectUri: validateRedirectUri(input.redirectUri),
      updatedAt: now,
      ...(authType === "client_certificate"
        ? {
            certificateRef,
            certificatePasswordRef,
            certificateThumbprint:
              certificate?.thumbprint ?? existing.certificateThumbprint,
            certificateExpiresAt:
              certificate?.expiresAt ?? existing.certificateExpiresAt,
          }
        : {}),
    };
    if (authType === "client_certificate" && certificate) {
      await this.payloadStore.putSecret({
        secretRefId: certificateRef,
        plaintext: nonEmpty(input.certificatePfx ?? "", "certificatePfx"),
      });
      await this.payloadStore.putSecret({
        secretRefId: certificatePasswordRef,
        plaintext: nonEmpty(input.certificatePassword ?? "", "certificatePassword"),
      });
    } else if (input.pkce) {
      update.pkce = true;
    } else if (input.clientSecret) {
      // Switching to (or staying) confidential: a new secret must be persisted.
      await this.payloadStore.putSecret({
        secretRefId: existing.clientSecretRef,
        plaintext: nonEmpty(input.clientSecret, "clientSecret"),
      });
    } else if (
      authType === "authorization_code" &&
      (existing.pkce || existing.authType === "client_certificate")
    ) {
      // Toggling an existing PKCE connector to confidential requires a secret;
      // without one the connector would be a confidential client with no secret.
      throw new ApiError(
        "A client secret is required when switching to confidential authorization-code mode",
        400,
        "VALIDATION_ERROR",
      );
    }
    // `$set: { pkce: undefined }` is a no-op in MongoDB, so a PKCE→confidential
    // switch must explicitly `$unset` the flag to clear it.
    const writeUpdate =
      authType === "authorization_code" && input.pkce
        ? { $set: update }
        : { $set: update, $unset: { pkce: "" } };
    await this.connectorsCollection.updateOne?.({ id: existing.id }, writeUpdate);
    return toConnectorMetadata({
      ...existing,
      ...update,
      pkce:
        authType === "authorization_code" && input.pkce ? true : undefined,
    });
  }

  async deleteConnector(connectorId: string): Promise<void> {
    const existing = await this.connectorsCollection.findOne({ id: nonEmpty(connectorId, "connectorId") });
    if (!existing) {
      throw new ApiError("OAuth connector was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    if (!this.connectorsCollection.updateOne) return;
    await this.connectorsCollection.updateOne(
      { id: existing.id },
      { $set: { enabled: false, updatedAt: this.now() } },
    );
  }
}

export class ProviderConnectionService {
  private readonly providerConnectionsCollection: Collection<ProviderConnectionDocument>;
  private readonly connectorsCollection: Collection<OAuthConnectorDocument>;
  private readonly payloadStore: Required<Pick<PayloadStore, "getSecret" | "putSecret">>;
  private readonly tokenClient: ProviderConnectionServiceOptions["tokenClient"];
  private readonly certificateAssertionFactory: NonNullable<
    ProviderConnectionServiceOptions["certificateAssertionFactory"]
  >;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;

  constructor(options: ProviderConnectionServiceOptions) {
    this.providerConnectionsCollection = options.providerConnectionsCollection;
    this.connectorsCollection = options.connectorsCollection;
    this.payloadStore = options.payloadStore;
    this.tokenClient = options.tokenClient;
    this.certificateAssertionFactory =
      options.certificateAssertionFactory ?? createCertificateClientAssertion;
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

  private async issueCertificateToken(
    connector: OAuthConnectorDocument,
    scopes: string[],
  ): Promise<TokenClientResponse> {
    if (
      connector.authType !== "client_certificate" ||
      !connector.certificateRef ||
      !connector.certificatePasswordRef
    ) {
      throw new ApiError(
        "Certificate OAuth is not configured for this connector",
        400,
        "CERTIFICATE_NOT_CONFIGURED",
      );
    }
    const [pfxBase64, password] = await Promise.all([
      this.payloadStore.getSecret(connector.certificateRef),
      this.payloadStore.getSecret(connector.certificatePasswordRef),
    ]);
    const clientAssertion = await this.certificateAssertionFactory({
      clientId: connector.clientId,
      tokenUrl: connector.tokenUrl,
      pfxBase64,
      password,
      now: this.now(),
    });
    return this.tokenClient(
      connector.tokenUrl,
      certificateClientCredentialsTokenBody({
        clientId: connector.clientId,
        clientAssertion,
        scopes,
      }),
    );
  }

  async connectClientCredentials(input: {
    providerKey: string;
    owner: CredentialOwnerRef;
    requestedScopes?: string[];
  }): Promise<CompletedProviderConnection> {
    const connector = await this.findEnabledConnector(
      nonEmpty(input.providerKey, "providerKey"),
    );
    if (connector.authType !== "client_certificate") {
      throw new ApiError(
        "This connector requires the authorization-code flow",
        400,
        "UNSUPPORTED_OAUTH_FLOW",
      );
    }
    const requestedScopes = boundScopes(connector.scopes, input.requestedScopes);
    const token = await this.issueCertificateToken(connector, requestedScopes);
    const id = this.idGenerator();
    const accessTokenRef = `provider_connection:${id}:access_token`;
    await this.payloadStore.putSecret({
      secretRefId: accessTokenRef,
      plaintext: nonEmpty(token.access_token, "access_token"),
    });

    const now = this.now();
    const grantedScopes = token.scope
      ? Array.from(
          new Set(
            token.scope
              .split(/[\s,]+/)
              .map((scope) => scope.trim())
              .filter(Boolean),
          ),
        )
      : undefined;
    const doc: ProviderConnectionDocument = {
      id,
      connectorId: connector.id,
      provider: connector.provider,
      owner: input.owner,
      status: "connected",
      renewable: true,
      accessTokenRef,
      refreshTokenRef: "",
      expiresAt: token.expires_in
        ? new Date(now.getTime() + token.expires_in * 1000)
        : undefined,
      connectedAt: now,
      updatedAt: now,
      requestedScopes,
      ...(grantedScopes ? { grantedScopes } : {}),
    };
    const supersededConnectionIds = await this.disableSupersededConnections(
      input.owner,
      connector.provider,
      id,
    );
    await this.providerConnectionsCollection.insertOne(doc);
    return {
      ...toProviderConnectionMetadata(doc),
      supersededConnectionIds,
    };
  }

  async startConnection(input: {
    providerKey: string;
    owner: CredentialOwnerRef;
    state: string;
    codeChallenge: string;
    requestedScopes?: string[];
  }): Promise<{ authorizationUrl: string; connectorId: string; requestedScopes: string[] }> {
    const connector = await this.findEnabledConnector(nonEmpty(input.providerKey, "providerKey"));
    if (connector.authType === "client_certificate") {
      throw new ApiError(
        "Certificate connectors must be connected with a POST request",
        405,
        "UNSUPPORTED_OAUTH_FLOW",
      );
    }
    const requestedScopes = boundScopes(connector.scopes, input.requestedScopes);
    const url = new URL(connector.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", connector.clientId);
    url.searchParams.set("redirect_uri", connector.redirectUri);
    url.searchParams.set("scope", authorizationScopes(connector.provider, requestedScopes).join(" "));
    url.searchParams.set("state", nonEmpty(input.state, "state"));
    url.searchParams.set("code_challenge", nonEmpty(input.codeChallenge, "codeChallenge"));
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), connectorId: connector.id, requestedScopes };
  }

  private async findOwnerDocuments(owner: CredentialOwnerRef): Promise<ProviderConnectionDocument[]> {
    if (!this.providerConnectionsCollection.find) {
      return [];
    }
    const docs = await this.providerConnectionsCollection.find().sort({ updatedAt: -1 }).toArray();
    return docs.filter((doc) => doc.owner.type === owner.type && doc.owner.id === owner.id);
  }

  private async disableConnection(connectionId: string): Promise<void> {
    if (!this.providerConnectionsCollection.updateOne) return;
    await this.providerConnectionsCollection.updateOne(
      { id: connectionId },
      { $set: { status: "disabled", updatedAt: this.now() } },
    );
  }

  private async disableSupersededConnections(
    owner: CredentialOwnerRef,
    provider: string,
    keepId: string,
  ): Promise<string[]> {
    const docs = await this.findOwnerDocuments(owner);
    const superseded = docs.filter(
      (doc) =>
        (doc.provider ?? doc.connectorId) === provider &&
        doc.id !== keepId &&
        (doc.status === "connected" || doc.status === "needs_reauth"),
    );
    await Promise.all(superseded.map((doc) => this.disableConnection(doc.id)));
    return superseded.map((doc) => doc.id);
  }

  /**
   * Keep the newest active connection per provider and disable older duplicates.
   * Idempotent and safe to run on every list call.
   */
  async pruneStaleConnections(owner: CredentialOwnerRef): Promise<number> {
    const docs = await this.findOwnerDocuments(owner);
    const grouped = new Map<string, ProviderConnectionDocument[]>();
    for (const doc of docs) {
      const provider = doc.provider ?? doc.connectorId;
      const bucket = grouped.get(provider) ?? [];
      bucket.push(doc);
      grouped.set(provider, bucket);
    }

    let pruned = 0;
    for (const group of grouped.values()) {
      const active = group.filter((doc) => doc.status === "connected" || doc.status === "needs_reauth");
      if (active.length <= 1) continue;
      active.sort((left, right) => {
        const leftTime = left.updatedAt?.getTime() ?? left.connectedAt?.getTime() ?? 0;
        const rightTime = right.updatedAt?.getTime() ?? right.connectedAt?.getTime() ?? 0;
        return rightTime - leftTime;
      });
      for (const stale of active.slice(1)) {
        await this.disableConnection(stale.id);
        pruned += 1;
      }
    }
    return pruned;
  }

  async revokeConnection(input: {
    connectionId: string;
    owner: CredentialOwnerRef;
  }): Promise<ProviderConnectionMetadata> {
    const connection = await this.providerConnectionsCollection.findOne({
      id: nonEmpty(input.connectionId, "connectionId"),
    });
    if (!connection) {
      throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    if (
      connection.owner.type !== input.owner.type ||
      connection.owner.id !== input.owner.id
    ) {
      throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    if (connection.status === "disabled") {
      return toProviderConnectionMetadata(connection);
    }
    await this.disableConnection(connection.id);
    return toProviderConnectionMetadata({
      ...connection,
      status: "disabled",
      updatedAt: this.now(),
    });
  }

  async updateConnectionProfileSummary(input: {
    connectionId: string;
    owner: CredentialOwnerRef;
    profileSummary?: string;
  }): Promise<void> {
    const connection = await this.providerConnectionsCollection.findOne({
      id: nonEmpty(input.connectionId, "connectionId"),
    });
    if (
      !connection ||
      connection.owner.type !== input.owner.type ||
      connection.owner.id !== input.owner.id
    ) {
      return;
    }
    if (!this.providerConnectionsCollection.updateOne) return;
    const now = this.now();
    await this.providerConnectionsCollection.updateOne(
      { id: connection.id },
      {
        $set: {
          ...(input.profileSummary ? { profileSummary: input.profileSummary } : {}),
          profileCheckedAt: now,
          updatedAt: now,
        },
      },
    );
  }

  async completeConnection(input: {
    providerKey: string;
    owner: CredentialOwnerRef;
    code: string;
    codeVerifier: string;
    requestedScopes?: string[];
  }): Promise<CompletedProviderConnection> {
    const connector = await this.findEnabledConnector(nonEmpty(input.providerKey, "providerKey"));
    const clientSecret = connector.pkce ? "" : await this.payloadStore.getSecret(connector.clientSecretRef);
    const token = await this.tokenClient(
      connector.tokenUrl,
      authorizationCodeTokenBody({
        provider: connector.provider,
        clientId: connector.clientId,
        clientSecret,
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirectUri: connector.redirectUri,
        pkce: connector.pkce,
      }),
    );

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

    const requestedScopes =
      input.requestedScopes !== undefined
        ? boundScopes(connector.scopes, input.requestedScopes)
        : undefined;
    const grantedScopes = token.scope
      ? Array.from(new Set(token.scope.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean)))
      : undefined;

    const now = this.now();
    const doc: ProviderConnectionDocument = {
      id,
      connectorId: connector.id,
      provider: connector.provider,
      owner: input.owner,
      // A freshly issued access token is usable now, so the connection is
      // "connected" regardless of whether the provider returned a refresh token.
      // Public/PKCE clients (e.g. CO2) often return an access token with
      // `expires_in` but no `refresh_token`; refreshConnection already falls back
      // to reusing the stored access token for refresh-less connections. Marking
      // these "needs_reauth" at creation would hide a working connection from
      // listConnections (which filters to status === "connected").
      status: "connected",
      renewable: Boolean(token.refresh_token),
      accessTokenRef,
      refreshTokenRef,
      expiresAt: token.expires_in ? new Date(now.getTime() + token.expires_in * 1000) : undefined,
      connectedAt: now,
      updatedAt: now,
      ...(requestedScopes ? { requestedScopes } : {}),
      ...(grantedScopes ? { grantedScopes } : {}),
    };
    const supersededConnectionIds = await this.disableSupersededConnections(
      input.owner,
      connector.provider,
      id,
    );
    await this.providerConnectionsCollection.insertOne(doc);
    return {
      ...toProviderConnectionMetadata(doc),
      supersededConnectionIds,
    };
  }

  /**
   * Register a pasted static access token as a provider connection.
   *
   * This is the paste-token analogue of {@link completeConnection}: instead of
   * exchanging an OAuth authorization code, the caller supplies a long-lived
   * token (e.g. a GitLab project access token or a GitHub personal access token)
   * that was obtained out-of-band. The resulting `ProviderConnectionDocument`
   * has `status: "connected"`, no `refreshTokenRef` secret, and no `expiresAt` —
   * matching the shape that {@link refreshConnection} already handles correctly
   * for refresh-less connections (lines 496-499: reuse stored access token).
   *
   * The method is owner-agnostic: `input.owner.type` may be `"user"`,
   * `"service_account"`, `"team"`, or `"organization"`.
   */
  async registerStaticToken(input: {
    providerKey: string;
    owner: CredentialOwnerRef;
    accessToken: string;
    requestedScopes?: string[];
  }): Promise<CompletedProviderConnection> {
    // A pasted token (PAT / project access token) does NOT require a registered
    // OAuth connector — there is no authorization-code flow, no client app, and
    // no client secret. Earlier this called findEnabledConnector, which 404'd
    // ("OAuth connector was not found") for providers like GitLab where we have
    // no OAuth app but DO support PATs. The connector was only used for two
    // non-essential things: its id (stored, never used to resolve anything) and
    // its scope list (to bound requestedScopes). We don't need either here:
    //   - connectorId is synthesised as `static:<provider>` purely for display.
    //   - the PAT carries its own scopes intrinsically, so we store the caller's
    //     requestedScopes verbatim (informational) rather than bounding them.
    const provider = nonEmpty(input.providerKey, "providerKey");
    const requestedScopes =
      input.requestedScopes && input.requestedScopes.length > 0
        ? input.requestedScopes
        : undefined;

    const id = this.idGenerator();
    const accessTokenRef = `provider_connection:${id}:access_token`;
    await this.payloadStore.putSecret({
      secretRefId: accessTokenRef,
      plaintext: nonEmpty(input.accessToken, "accessToken"),
    });

    const now = this.now();
    const doc: ProviderConnectionDocument = {
      id,
      connectorId: `static:${provider}`,
      provider,
      owner: input.owner,
      status: "connected",
      // Static tokens cannot be silently renewed via an OAuth refresh grant.
      renewable: false,
      accessTokenRef,
      // No refresh token — static tokens are long-lived and not rotated via
      // an OAuth refresh grant. refreshConnection already handles this case.
      refreshTokenRef: "",
      // No expiresAt — caller manages token lifecycle out-of-band.
      connectedAt: now,
      updatedAt: now,
      ...(requestedScopes ? { requestedScopes } : {}),
    };
    const supersededConnectionIds = await this.disableSupersededConnections(
      input.owner,
      provider,
      id,
    );
    await this.providerConnectionsCollection.insertOne(doc);
    return {
      ...toProviderConnectionMetadata(doc),
      supersededConnectionIds,
    };
  }

  async listConnections(
    owner: CredentialOwnerRef,
    options?: { includeDisabled?: boolean },
  ): Promise<ProviderConnectionMetadata[]> {
    await this.pruneStaleConnections(owner);
    const docs = await this.findOwnerDocuments(owner);
    return docs
      .filter((doc) => options?.includeDisabled || doc.status === "connected")
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

    // The stored access token is the source of truth. Long-lived tokens such as
    // GitHub OAuth-App tokens never expire and are not issued with a refresh
    // token, so we must be able to fall back to reusing the stored token when a
    // refresh-token grant is impossible (no refresh token) or rejected by the
    // provider (HTTP 400). Failing the exchange here is what forced callers like
    // dynamic-agents to fall back to a static .env PAT.
    let storedAccessToken: string | undefined;
    try {
      storedAccessToken = await this.payloadStore.getSecret(connection.accessTokenRef);
    } catch {
      storedAccessToken = undefined;
    }

    let refreshToken: string | undefined;
    try {
      refreshToken = await this.payloadStore.getSecret(connection.refreshTokenRef);
    } catch {
      refreshToken = undefined;
    }

    const reuseStoredToken = (): { accessToken: string; expiresIn?: number } => {
      if (!storedAccessToken) {
        throw new ApiError(
          "Provider connection requires re-authentication",
          401,
          "CREDENTIAL_REAUTH_REQUIRED",
        );
      }
      const expiresAt = connection.expiresAt ? new Date(connection.expiresAt) : undefined;
      const expiresIn = expiresAt
        ? Math.max(0, Math.floor((expiresAt.getTime() - this.now().getTime()) / 1000))
        : undefined;
      return { accessToken: storedAccessToken, expiresIn };
    };

    // `connector` is intentionally null in two distinct cases, BOTH of which
    // reuse the stored access token rather than attempting an OAuth refresh:
    //
    //   1. Static token: a pasted PAT / project access token has NO OAuth
    //      connector — registerStaticToken stores connectorId as
    //      `static:<provider>` and writes no refresh token. We skip the
    //      connector lookup entirely. Looking one up would 404 ("OAuth
    //      connector was not found") and break the exchange for every static
    //      token (the symptom that blocked GitLab PAT passthrough for both
    //      users and service accounts).
    //   2. Deleted connector: an OAuth connection whose connector row was
    //      removed after the connection was created. Rather than 404 the
    //      exchange (the prior behavior), we gracefully degrade to the last
    //      known-good stored access token; the caller can re-connect/rotate if
    //      it has gone stale.
    const connector = connection.connectorId.startsWith("static:")
      ? null
      : await this.connectorsCollection.findOne({ id: connection.connectorId });
    if (!connector) {
      return reuseStoredToken();
    }

    if (connector.authType === "client_certificate") {
      const expiresAt = connection.expiresAt
        ? new Date(connection.expiresAt)
        : undefined;
      if (
        storedAccessToken &&
        (!expiresAt || expiresAt.getTime() > this.now().getTime() + 60_000)
      ) {
        return reuseStoredToken();
      }
      const scopes = boundScopes(
        connector.scopes,
        connection.requestedScopes,
      );
      const token = await this.issueCertificateToken(connector, scopes);
      const now = this.now();
      const nextExpiresAt = token.expires_in
        ? new Date(now.getTime() + token.expires_in * 1000)
        : undefined;
      await this.payloadStore.putSecret({
        secretRefId: connection.accessTokenRef,
        plaintext: nonEmpty(token.access_token, "access_token"),
      });
      await this.providerConnectionsCollection.updateOne?.(
        { id: connectionId },
        {
          $set: {
            status: "connected",
            renewable: true,
            ...(nextExpiresAt ? { expiresAt: nextExpiresAt } : {}),
            updatedAt: now,
          },
        },
      );
      return {
        accessToken: token.access_token,
        expiresIn: token.expires_in,
      };
    }

    // No usable refresh token (e.g. GitHub never issued one): reuse the stored
    // access token instead of attempting a doomed refresh grant.
    if (!refreshToken) {
      return reuseStoredToken();
    }

    const clientSecret = connector.pkce ? "" : await this.payloadStore.getSecret(connector.clientSecretRef);
    let token: TokenClientResponse;
    try {
      token = await this.tokenClient(
        connector.tokenUrl,
        refreshTokenBody({
          provider: connector.provider,
          clientId: connector.clientId,
          clientSecret,
          refreshToken,
          pkce: connector.pkce,
        }),
      );
    } catch (error) {
      // The provider rejected the refresh token (GitHub returns 400 for tokens
      // that do not support refresh). Reuse the still-valid stored access token
      // rather than failing the exchange and forcing a static PAT fallback.
      if (storedAccessToken) {
        return reuseStoredToken();
      }
      throw error;
    }

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
          // Only update `renewable` when the provider returned a new refresh
          // token. Providers that don't rotate their refresh token omit it from
          // the response; overwriting with `false` here would incorrectly mark a
          // still-renewable connection as non-auto-renew.
          ...(token.refresh_token ? { renewable: true } : {}),
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
    connectedAt: doc.connectedAt ?? doc.updatedAt,
    updatedAt: doc.updatedAt,
    ...(doc.renewable !== undefined ? { renewable: doc.renewable } : {}),
    ...(doc.profileSummary ? { profileSummary: doc.profileSummary } : {}),
    ...(doc.profileCheckedAt ? { profileCheckedAt: doc.profileCheckedAt } : {}),
    ...(doc.requestedScopes ? { requestedScopes: doc.requestedScopes } : {}),
    ...(doc.grantedScopes ? { grantedScopes: doc.grantedScopes } : {}),
  };
}
