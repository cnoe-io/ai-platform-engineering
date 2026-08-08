import { ApiError } from "@/lib/api-error";

import type {
  CreateConnectorInput,
  OAuthConnectorMetadata,
  OAuthConnectorService,
} from "./oauth-service";

type FetchLike = typeof fetch;

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

interface DynamicClientRegistrationResponse {
  client_id: string;
  registration_access_token?: string;
  registration_client_uri?: string;
}

export interface RegisterMcpDcrConnectorInput {
  name: string;
  provider: string;
  mcpUrl: string;
  redirectUri: string;
  scopes?: string[];
}

export interface McpDcrDiscovery {
  resource: string;
  resourceMetadataUrl: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  scopes: string[];
}

function nonEmpty(value: unknown, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new ApiError(`${field} is required`, 400, "VALIDATION_ERROR");
  }
  return trimmed;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function validateRemoteUrl(value: unknown, field: string): string {
  let url: URL;
  try {
    url = new URL(nonEmpty(value, field));
  } catch {
    throw new ApiError(`${field} must be a valid URL`, 400, "VALIDATION_ERROR");
  }
  const hostname = url.hostname.toLowerCase();
  const localhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const localDevelopment = process.env.NODE_ENV !== "production" && localhost;
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopment)) ||
    hostname.endsWith(".local") ||
    (isPrivateIpv4(hostname) && !localDevelopment)
  ) {
    throw new ApiError(`${field} must be a public HTTPS URL`, 400, "VALIDATION_ERROR");
  }
  url.hash = "";
  return url.toString();
}

function derivedResourceMetadataUrl(mcpUrl: string): string {
  const resource = new URL(mcpUrl);
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}

function resourceMetadataFromChallenge(header: string | null): string | null {
  if (!header) return null;
  const match = /(?:^|[,\s])resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
  return match?.[1] ?? null;
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const timeoutSignal =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined;
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? timeoutSignal,
  });
  if (!response.ok) {
    throw new ApiError(
      `OAuth discovery request failed with HTTP ${response.status}`,
      400,
      "MCP_OAUTH_DISCOVERY_FAILED",
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(
      "OAuth discovery endpoint did not return JSON",
      400,
      "MCP_OAUTH_DISCOVERY_FAILED",
    );
  }
}

async function discoverResourceMetadataUrl(fetchImpl: FetchLike, mcpUrl: string): Promise<string> {
  try {
    const response = await fetchImpl(mcpUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "grid-oauth-discovery",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "GRID", version: "1" },
        },
      }),
      redirect: "error",
      signal:
        typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
    });
    const challenged = resourceMetadataFromChallenge(response.headers.get("www-authenticate"));
    if (challenged) return validateRemoteUrl(challenged, "resourceMetadataUrl");
  } catch {
    // RFC 9728 defines a deterministic well-known fallback. A network or
    // method error on the MCP endpoint must not prevent standards discovery.
  }
  return validateRemoteUrl(derivedResourceMetadataUrl(mcpUrl), "resourceMetadataUrl");
}

function authorizationMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const issuerPath = url.pathname.replace(/\/$/, "");
  return [
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    `${url.origin}/.well-known/oauth-authorization-server${issuerPath}`,
  ];
}

async function fetchAuthorizationMetadata(
  fetchImpl: FetchLike,
  issuer: string,
): Promise<AuthorizationServerMetadata> {
  let lastError: unknown;
  for (const candidate of authorizationMetadataUrls(issuer)) {
    try {
      const metadata = await fetchJson<AuthorizationServerMetadata>(
        fetchImpl,
        validateRemoteUrl(candidate, "authorizationServerMetadataUrl"),
      );
      if (metadata.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) {
        throw new ApiError(
          "Authorization server metadata issuer does not match the advertised issuer",
          400,
          "MCP_OAUTH_ISSUER_MISMATCH",
        );
      }
      return metadata;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ApiError(
        "Authorization server metadata could not be discovered",
        400,
        "MCP_OAUTH_DISCOVERY_FAILED",
      );
}

function selectScopes(
  requested: string[] | undefined,
  resourceScopes: string[] | undefined,
  authorizationScopes: string[] | undefined,
): string[] {
  const resourceAllowed = new Set((resourceScopes ?? []).map((scope) => scope.trim()).filter(Boolean));
  const authorizationAllowed = new Set(
    (authorizationScopes ?? []).map((scope) => scope.trim()).filter(Boolean),
  );
  const defaults = resourceAllowed.size > 0
    ? Array.from(resourceAllowed)
    : authorizationAllowed.size > 0
      ? Array.from(authorizationAllowed)
      : ["openid"];
  const selected = Array.from(
    new Set((requested ?? defaults).map((scope) => scope.trim()).filter(Boolean)),
  );
  const unsupported = selected.filter(
    (scope) =>
      (resourceAllowed.size > 0 && !resourceAllowed.has(scope)) ||
      (authorizationAllowed.size > 0 && !authorizationAllowed.has(scope)),
  );
  if (unsupported.length > 0) {
    throw new ApiError(
      `Requested scopes are not supported by the MCP OAuth provider: ${unsupported.join(", ")}`,
      400,
      "VALIDATION_ERROR",
    );
  }
  return selected;
}

export async function discoverMcpOAuth(
  input: Pick<RegisterMcpDcrConnectorInput, "mcpUrl" | "scopes">,
  fetchImpl: FetchLike = fetch,
): Promise<McpDcrDiscovery> {
  const mcpUrl = validateRemoteUrl(input.mcpUrl, "mcpUrl");
  const resourceMetadataUrl = await discoverResourceMetadataUrl(fetchImpl, mcpUrl);
  const resourceMetadata = await fetchJson<ProtectedResourceMetadata>(
    fetchImpl,
    resourceMetadataUrl,
  );
  const resource = validateRemoteUrl(resourceMetadata.resource, "resource");
  const issuer = validateRemoteUrl(
    resourceMetadata.authorization_servers?.[0] ?? "",
    "authorizationServer",
  ).replace(/\/$/, "");
  const authorizationMetadata = await fetchAuthorizationMetadata(fetchImpl, issuer);
  const pkceMethods = authorizationMetadata.code_challenge_methods_supported;
  if (pkceMethods && !pkceMethods.includes("S256")) {
    throw new ApiError(
      "The MCP authorization server does not support PKCE S256",
      400,
      "MCP_OAUTH_PKCE_UNSUPPORTED",
    );
  }
  return {
    resource,
    resourceMetadataUrl,
    issuer,
    authorizationEndpoint: validateRemoteUrl(
      authorizationMetadata.authorization_endpoint,
      "authorizationEndpoint",
    ),
    tokenEndpoint: validateRemoteUrl(authorizationMetadata.token_endpoint, "tokenEndpoint"),
    registrationEndpoint: validateRemoteUrl(
      authorizationMetadata.registration_endpoint,
      "registrationEndpoint",
    ),
    scopes: selectScopes(
      input.scopes,
      resourceMetadata.scopes_supported,
      authorizationMetadata.scopes_supported,
    ),
  };
}

export async function registerMcpDcrConnector(options: {
  input: RegisterMcpDcrConnectorInput;
  connectorService: Pick<OAuthConnectorService, "createConnector" | "listConnectors">;
  fetchImpl?: FetchLike;
}): Promise<OAuthConnectorMetadata> {
  const provider = nonEmpty(options.input.provider, "provider");
  const name = nonEmpty(options.input.name, "name");
  const redirectUri = validateRemoteUrl(options.input.redirectUri, "redirectUri");
  const existing = (await options.connectorService.listConnectors()).find(
    (connector) => connector.provider === provider,
  );
  if (existing) {
    throw new ApiError(
      `OAuth provider ${provider} is already configured`,
      409,
      "CREDENTIAL_ALREADY_EXISTS",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const discovery = await discoverMcpOAuth(options.input, fetchImpl);
  const registration = await fetchJson<DynamicClientRegistrationResponse>(
    fetchImpl,
    discovery.registrationEndpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: discovery.scopes.join(" "),
      }),
    },
  );
  const clientId = nonEmpty(registration.client_id, "client_id");
  const connectorInput: CreateConnectorInput = {
    name,
    provider,
    clientId,
    authorizationUrl: discovery.authorizationEndpoint,
    tokenUrl: discovery.tokenEndpoint,
    scopes: discovery.scopes,
    redirectUri,
    pkce: true,
    resource: discovery.resource,
    source: "mcp_dcr",
    registrationEndpoint: discovery.registrationEndpoint,
    ...(registration.registration_client_uri
      ? { registrationClientUri: registration.registration_client_uri }
      : {}),
    ...(registration.registration_access_token
      ? { registrationAccessToken: registration.registration_access_token }
      : {}),
  };
  return options.connectorService.createConnector(connectorInput);
}
