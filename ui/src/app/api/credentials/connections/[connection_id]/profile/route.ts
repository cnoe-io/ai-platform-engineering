import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

type Provider = "github" | "atlassian" | "webex";
type ProviderProfileFailure = {
  ok: false;
  status: number;
  message: string;
};
type TokenDiagnostic = {
  id: string;
  label: string;
  status: "passed" | "warning" | "failed";
  detail: string;
  action: string;
  http_status?: number;
};

interface RouteContext {
  params: Promise<{ connection_id: string }>;
}

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

function profileEndpoint(provider: Provider): string {
  switch (provider) {
    case "github":
      return "https://api.github.com/user";
    case "atlassian":
      return "https://api.atlassian.com/me";
    case "webex":
      return "https://webexapis.com/v1/people/me";
  }
}

function atlassianAccessibleResourcesEndpoint(): string {
  return "https://api.atlassian.com/oauth/token/accessible-resources";
}

function providerDisplayName(provider: Provider): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "atlassian":
      return "Atlassian";
    case "webex":
      return "Webex";
  }
}

function profileHeaders(provider: Provider, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
  };
  if (provider === "github") {
    headers["x-github-api-version"] = "2022-11-28";
  }
  return headers;
}

function safeProfile(provider: Provider, payload: Record<string, unknown>): Record<string, unknown> {
  switch (provider) {
    case "github":
      return {
        id: payload.id,
        login: payload.login,
        name: payload.name,
        email: payload.email,
        html_url: payload.html_url,
      };
    case "atlassian":
      return {
        account_id: payload.account_id,
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
      };
    case "webex":
      return {
        id: payload.id,
        displayName: payload.displayName,
        emails: payload.emails,
        userName: payload.userName,
      };
  }
}

function providerFailure(
  provider: Provider,
  status: number,
  payload: Record<string, unknown>,
): ProviderProfileFailure {
  const message =
    typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string"
        ? payload.error
        : `Profile check failed with HTTP ${status}`;
  console.warn(
    `[credentials] ${provider} profile check failed with HTTP ${status}: ${message}`,
  );
  return {
    ok: false,
    status,
    message,
  };
}

function connectionOwnerDiagnostic(): TokenDiagnostic {
  return {
    id: "connection_owner",
    label: "Connection ownership",
    status: "passed",
    detail: "This connection belongs to the signed-in user.",
    action: "No action needed.",
  };
}

function tokenRefreshDiagnostic(provider: Provider): TokenDiagnostic {
  return {
    id: "token_refresh",
    label: "Token refresh",
    status: "passed",
    detail: `${providerDisplayName(provider)} accepted the refresh token.`,
    action: "No action needed.",
  };
}

function tokenRefreshFailureDiagnostic(provider: Provider): TokenDiagnostic {
  return {
    id: "token_refresh",
    label: "Token refresh",
    status: "failed",
    detail: `${providerDisplayName(provider)} did not accept the stored refresh token.`,
    action: `Relink ${providerDisplayName(provider)} to grant CAIPE a fresh refresh token.`,
  };
}

function profileDiagnostic(provider: Provider, failure?: ProviderProfileFailure): TokenDiagnostic {
  if (!failure) {
    return {
      id: "provider_profile",
      label: `${providerDisplayName(provider)} user profile`,
      status: "passed",
      detail: `${providerDisplayName(provider)} returned a redacted user profile.`,
      action: "No action needed.",
    };
  }
  return {
    id: "provider_profile",
    label: `${providerDisplayName(provider)} user profile`,
    status: provider === "atlassian" && failure.status === 403 ? "warning" : "failed",
    detail: `${providerDisplayName(provider)} returned HTTP ${failure.status}: ${failure.message}.`,
    action:
      provider === "atlassian" && failure.status === 403
        ? "Ask an Atlassian admin to verify User Identity API access, or rely on accessible resources for token validation."
        : `Relink ${providerDisplayName(provider)} and try the profile check again.`,
    http_status: failure.status,
  };
}

function atlassianResourcesDiagnostic(
  resources: Array<Record<string, unknown>>,
): TokenDiagnostic {
  return {
    id: "atlassian_accessible_resources",
    label: "Accessible Atlassian sites",
    status: resources.length > 0 ? "passed" : "warning",
    detail: summarizeAtlassianResources(resources),
    action: resources.length > 0 ? "No action needed." : "Relink Atlassian and select an Atlassian site.",
  };
}

export const POST = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  assertFeatureEnabled();
  const { connection_id: connectionId } = await context.params;
  if (!connectionId?.trim()) {
    throw new ApiError("connection_id is required", 400, "VALIDATION_ERROR");
  }

  const { session } = await getAuthFromBearerOrSession(request);
  const ownerId = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!ownerId) {
    throw new ApiError("Authenticated subject is required", 401, "UNAUTHORIZED");
  }

  const service = await getProviderConnectionService();
  const connection = (await service.listConnections({ type: "user", id: ownerId })).find(
    (candidate) => candidate.id === connectionId,
  );
  if (!connection) {
    throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
  }
  if (!["github", "atlassian", "webex"].includes(connection.provider)) {
    throw new ApiError("Provider profile checks are not supported", 400, "UNSUPPORTED_PROVIDER");
  }

  const provider = connection.provider as Provider;
  const diagnostics: TokenDiagnostic[] = [connectionOwnerDiagnostic()];
  let token: Awaited<ReturnType<typeof service.refreshConnection>>;
  try {
    token = await service.refreshConnection(connection.id);
    diagnostics.push(tokenRefreshDiagnostic(provider));
  } catch {
    const refreshFailure = tokenRefreshFailureDiagnostic(provider);
    diagnostics.push(refreshFailure);
    return successResponse({
      provider,
      ok: false,
      checked_at: new Date().toISOString(),
      diagnostics,
      next_action: refreshFailure.action,
    });
  }
  const profileResponse = await fetch(profileEndpoint(provider), {
    headers: profileHeaders(provider, token.accessToken),
  });
  const profilePayload = (await profileResponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!profileResponse.ok) {
    const failure = providerFailure(provider, profileResponse.status, profilePayload);
    diagnostics.push(profileDiagnostic(provider, failure));
    if (provider === "atlassian") {
      const resourcesResponse = await fetch(atlassianAccessibleResourcesEndpoint(), {
        headers: profileHeaders(provider, token.accessToken),
      });
      const resourcesPayload = await resourcesResponse.json().catch(() => []);
      if (resourcesResponse.ok && Array.isArray(resourcesPayload)) {
        const accessibleResources = resourcesPayload.map((resource) =>
          safeAtlassianResource(resource as Record<string, unknown>),
        );
        diagnostics.push(atlassianResourcesDiagnostic(accessibleResources));
        return successResponse({
          provider,
          ok: true,
          checked_at: new Date().toISOString(),
          profile_check: failure,
          accessible_resources: accessibleResources,
          diagnostics,
          next_action:
            "Token is valid for Atlassian resources; profile endpoint needs Atlassian app/user permission review.",
        });
      }
    }
    return successResponse({
      provider,
      ok: false,
      status: failure.status,
      message: failure.message,
      checked_at: new Date().toISOString(),
      diagnostics,
      next_action: profileDiagnostic(provider, failure).action,
    });
  }

  diagnostics.push(profileDiagnostic(provider));
  return successResponse({
    provider,
    ok: true,
    checked_at: new Date().toISOString(),
    profile: safeProfile(provider, profilePayload),
    diagnostics,
    next_action: "No action needed.",
  });
});

function safeAtlassianResource(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    id: payload.id,
    name: payload.name,
    url: payload.url,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.map(String) : undefined,
    avatarUrl: payload.avatarUrl,
  };
}

function summarizeAtlassianResources(resources: Array<Record<string, unknown>>): string {
  if (resources.length === 0) {
    return "No Atlassian sites were returned for this token.";
  }
  const siteNames = resources
    .map((resource) => resource.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .slice(0, 3)
    .join(", ");
  const scopes = Array.from(
    new Set(
      resources.flatMap((resource) =>
        Array.isArray(resource.scopes) ? resource.scopes.map(String) : [],
      ),
    ),
  )
    .slice(0, 5)
    .join(", ");
  return `${siteNames || `${resources.length} Atlassian site${resources.length === 1 ? "" : "s"}`} is accessible${scopes ? ` with ${scopes}` : ""}.`;
}
